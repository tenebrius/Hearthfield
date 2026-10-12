// Forager Lab simulation core for WebAssembly: the fast experiment engine.
//
// This is a port of the simulation in ../forager-lab.html (step, sense, think, mutate), written
// for speed. The HTML page stays the interactive version and the reference for behaviour.
// Differences from the page, all deliberate (results are statistically equivalent, not bit-identical):
//   - own tanh (rational approximation, error < 1e-6) and own log (no libm in freestanding WASM)
//   - gauss() uses the polar method; random headings use rejection sampling instead of cos/sin
//   - sight scan uses per-row bitmasks and stops early (same nearest tile and tie-break as the page)
//   - weights for inputs that are always zero (and for memory outputs when memory is off) are not stored at all;
//     they could never change behaviour, so this only changes how many (neutral) mutations a genome would carry
//   - forward pass in f32 with SIMD (weights stored input-major, so each input adds a whole row to the hidden layer,
//     and inputs that are zero this tick are skipped)
//   - not supported: food relocation (shiftEvery), the "newcomers copy parents" archive, mixed/split maps
// Build: see build.sh. Config layout: keep CFG_KEYS in engine.js in the same order as enum Cfg.

typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned long long u64;
#define EXPORT(n) __attribute__((export_name(n)))

#define W 64
#define H 64
#define N_IN 23
#define N_MEM 4
#define N_OUT (3 + 2 * N_MEM)
#define MAXHID 32
#define MAXA 2048
#define MAXG (N_IN * MAXHID + MAXHID * MAXHID + MAXHID * 12)   // input-major layers, columns padded to a multiple of 4
#define MIN_SEE 0.2

enum Cfg {
  C_REGROW, C_WREGROW, C_LOSSE, C_LOSSW, C_MOVEE, C_MOVEW, C_GAINE, C_GAINW, C_MAXE, C_MAXW,
  C_STARTE, C_STARTW, C_REQE, C_REQW, C_PAYE, C_PAYW, C_KIDE, C_KIDW, C_STEPLEN, C_COOLDOWN,
  C_SIGHT, C_HIDDEN, C_LAYERS, C_MEMORY, C_POSITION, C_NOISE, C_AGE, C_FEEDBACK, C_TUMBLE,
  C_TUMBLEEVERY, C_INERTIA, C_MUTRATE, C_MUTSIZE, C_BASELINE, C_FLOORN, C_MAXPOP, C_COUNT
};
static double CFG[64];
EXPORT("cfg_ptr") double *cfg_ptr(void) { return CFG; }
EXPORT("cfg_count") int cfg_count(void) { return C_COUNT; }

// ---------- random numbers: same mulberry32 stream as the page ----------
static u32 rs = 1, as = 1;
static inline double rng(void) {
  rs += 0x6D2B79F5u; u32 a = rs;
  u32 t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}
// separate stream for the optional random inputs, so toggling them never changes the world
static inline double aux(void) {
  as += 0x6D2B79F5u; u32 a = as;
  u32 t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}

static double mylog(double x) {
  union { double d; u64 u; } v; v.d = x;
  int e = (int)((v.u >> 52) & 0x7ff) - 1023;
  v.u = (v.u & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL;
  double m = v.d;
  if (m > 1.4142135623730951) { m *= 0.5; e += 1; }
  double s = (m - 1) / (m + 1), s2 = s * s;
  double r = s * (2 + s2 * (2.0 / 3 + s2 * (2.0 / 5 + s2 * (2.0 / 7 + s2 * (2.0 / 9 + s2 * (2.0 / 11 + s2 * (2.0 / 13)))))));
  return e * 0.6931471805599453 + r;
}
static double gauss(void) {
  double u, v, s;
  do { u = 2 * rng() - 1; v = 2 * rng() - 1; s = u * u + v * v; } while (s >= 1.0 || s == 0.0);
  return u * __builtin_sqrt(-2.0 * mylog(s) / s);
}
static inline double ftanh(double x) {
  if (x > 7.90531110763549805) x = 7.90531110763549805;
  else if (x < -7.90531110763549805) x = -7.90531110763549805;
  double x2 = x * x;
  double p = x * (4.89352455891786e-03 + x2 * (6.37261928875436e-04 + x2 * (1.48572235717979e-05 + x2 * (5.12229709037114e-08 + x2 * (-8.60467152213735e-11 + x2 * (2.00018790482477e-13 + x2 * -2.76076847742355e-16))))));
  double q = 4.89352518554385e-03 + x2 * (2.26843463243900e-03 + x2 * (1.18534705686654e-04 + x2 * 1.19825839466702e-06));
  return p / q;
}
EXPORT("tanh_test") double tanh_test(double x) { return ftanh(x); }
EXPORT("log_test") double log_test(double x) { return mylog(x); }

// ---------- world ----------
static float FOOD[W * H], FERT[W * H];
static u8 KIND[W * H];
static u64 FM[H], WM[H];            // per row: bit x set when a food / water tile there has at least MIN_SEE
static int FERTILE[W * H], NFERT;
EXPORT("kind_ptr") u8 *kind_ptr(void) { return KIND; }
EXPORT("fert_ptr") float *fert_ptr(void) { return FERT; }
EXPORT("food_ptr") float *food_ptr(void) { return FOOD; }

static void rebuild_masks(void) {
  for (int y = 0; y < H; y++) { FM[y] = 0; WM[y] = 0; }
  NFERT = 0;
  for (int i = 0; i < W * H; i++) {
    if (FERT[i] > 0) FERTILE[NFERT++] = i;
    if ((double)FOOD[i] >= MIN_SEE) {
      if (KIND[i] == 1) FM[i / W] |= 1ULL << (i % W);
      else if (KIND[i] == 3) WM[i / W] |= 1ULL << (i % W);
    }
  }
}
EXPORT("rebuild_masks") void rebuild_masks_export(void) { rebuild_masks(); }

// ---------- agents (struct of arrays, indexed by slot; ord[] is the iteration order) ----------
static float G[(u64)MAXA * MAXG], INP[MAXA * N_IN], MEM[MAXA * N_MEM];
static double AX[MAXA], AY[MAXA], AE[MAXA], AW[MAXA], AVX[MAXA], AVY[MAXA], AMX[MAXA], AMY[MAXA];
static double ABLK[MAXA], AEATRES[MAXA], AHX[MAXA], AHY[MAXA], AHT[MAXA];
static int ACD[MAXA], AAGE[MAXA], AGEN[MAXA], AEAT[MAXA];
static int ORD[MAXA], ORD2[MAXA], FREE[MAXA], KIDS[MAXA], NFREE, NAG;
static int NH, NL, NW, ACT[N_IN], NACT, HP, OP, NOUT, OFF2, OFFO, NREAL, REAL[MAXG];
static long long TICK, BORN, STARVED, THIRSTY;

EXPORT("n_agents") int n_agents(void) { return NAG; }
EXPORT("ord_ptr") int *ord_ptr(void) { return ORD; }
EXPORT("ax_ptr") double *ax_ptr(void) { return AX; }
EXPORT("ay_ptr") double *ay_ptr(void) { return AY; }
EXPORT("gen_ptr") int *gen_ptr(void) { return AGEN; }
EXPORT("tick") double get_tick(void) { return (double)TICK; }
EXPORT("born") double get_born(void) { return (double)BORN; }
EXPORT("starved") double get_starved(void) { return (double)STARVED; }
EXPORT("thirsty") double get_thirsty(void) { return (double)THIRSTY; }
EXPORT("inp_ptr") float *inp_ptr(void) { return INP; }
EXPORT("genome_ptr") float *genome_ptr(void) { return G; }
EXPORT("n_weights") int n_weights(void) { return NREAL; }
EXPORT("genome_stride") int genome_stride(void) { return NW; }
EXPORT("layout_info") int layout_info(int which) { return which == 0 ? HP : which == 1 ? OP : which == 2 ? OFF2 : which == 3 ? OFFO : NACT; }
EXPORT("act_ptr") int *act_ptr(void) { return ACT; }

static void setup_brain(void) {
  NH = (int)CFG[C_HIDDEN]; NL = (int)CFG[C_LAYERS];
  HP = (NH + 3) & ~3; NOUT = CFG[C_MEMORY] != 0 ? N_OUT : 3; OP = (NOUT + 3) & ~3;
  NACT = 0;
  for (int i = 0; i < N_IN; i++) {
    int on = 1;
    if (i >= 11 && i <= 14) on = CFG[C_MEMORY] != 0;
    else if (i == 15 || i == 16) on = CFG[C_POSITION] != 0;
    else if (i == 17) on = CFG[C_NOISE] != 0;
    else if (i == 18 || i == 19) on = CFG[C_FEEDBACK] != 0;
    else if (i == 20 || i == 21) on = CFG[C_TUMBLE] != 0;
    else if (i == 22) on = CFG[C_AGE] != 0;
    if (on) ACT[NACT++] = i;
  }
  OFF2 = NACT * HP; OFFO = OFF2 + (NL == 2 ? NH * HP : 0); NW = OFFO + NH * OP;
  NREAL = 0;   // offsets of the weights that exist (the padding columns stay 0)
  for (int k = 0; k < NACT; k++) for (int c = 0; c < NH; c++) REAL[NREAL++] = k * HP + c;
  if (NL == 2) for (int j = 0; j < NH; j++) for (int c = 0; c < NH; c++) REAL[NREAL++] = OFF2 + j * HP + c;
  for (int h = 0; h < NH; h++) for (int o = 0; o < NOUT; o++) REAL[NREAL++] = OFFO + h * OP + o;
}

static int alloc_slot(void) { return FREE[--NFREE]; }

static void new_agent(int s, double x, double y, int gen) {
  AX[s] = x; AY[s] = y; AE[s] = CFG[C_STARTE]; AW[s] = CFG[C_STARTW];
  AVX[s] = AVY[s] = AMX[s] = AMY[s] = 0; ABLK[s] = AEATRES[s] = 0; AHX[s] = AHY[s] = 0; AHT[s] = 0;
  ACD[s] = 0; AAGE[s] = 0; AGEN[s] = gen; AEAT[s] = 0;
  for (int m = 0; m < N_MEM; m++) MEM[s * N_MEM + m] = 0;
}
static int random_agent(void) {
  int s = alloc_slot(); float *g = G + (u64)s * NW;
  for (int i = 0; i < NW; i++) g[i] = 0;
  for (int k = 0; k < NREAL; k++) g[REAL[k]] = (float)(gauss() * 0.5);
  double x = rng() * W, y = rng() * H;
  new_agent(s, x, y, 0);
  return s;
}
static int mutate_child(int p) {
  int s = alloc_slot(); float *g = G + (u64)s * NW; const float *pg = G + (u64)p * NW;
  double mr = CFG[C_MUTRATE], ms = CFG[C_MUTSIZE];
  for (int i = 0; i < NW; i++) g[i] = pg[i];
  for (int k = 0; k < NREAL; k++) if (rng() < mr) g[REAL[k]] = (float)((double)g[REAL[k]] + gauss() * ms);
  new_agent(s, AX[p], AY[p], AGEN[p] + 1);
  return s;
}

EXPORT("init_world")
void init_world(u32 seed) {
  setup_brain();
  rs = seed; as = seed * 7919u + 13u;
  for (int i = 0; i < W * H; i++) FOOD[i] = FERT[i];
  rebuild_masks();
  NFREE = 0; for (int s = MAXA - 1; s >= 0; s--) FREE[NFREE++] = s;
  NAG = 0; TICK = 0; BORN = 0; STARVED = 0; THIRSTY = 0;
  for (int n = 0; n < 40; n++) ORD[NAG++] = random_agent();
}

// ---------- sensing ----------
// nearest tile in mask M within radius R of (x, y), excluding tile (ox, oy). Ties go to the lowest tile index, which is
// what a plain row-by-row scan gives. Returns tile index or -1, and the squared distance and offsets.
static int nearest(double x, double y, int ox, int oy, int R, const u64 *M, double *bd2, double *bdx, double *bdy) {
  double best = (double)R * R; int bi = 0x7fffffff, found = 0;
  int y0 = (int)(y - R); if (y - R < 0) y0 = 0; if (y0 < 0) y0 = 0;
  int y1 = (int)(y + R); if (y1 > H - 1) y1 = H - 1;
  int x0 = (int)(x - R); if (x - R < 0) x0 = 0;
  int x1 = (int)(x + R); if (x1 > W - 1) x1 = W - 1;
  u64 cols = (x1 - x0 == 63) ? ~0ULL : (((1ULL << (x1 - x0 + 1)) - 1) << x0);
  for (int k = 0; k <= 2 * R + 2; k++) {
    int any = 0;
    for (int side = 0; side < 2; side++) {
      int ty = side == 0 ? oy - k : oy + k;
      if (side == 1 && k == 0) continue;
      if (ty < y0 || ty > y1) continue;
      double dy = ty + 0.5 - y;
      if (dy * dy > best) continue;
      any = 1;
      u64 bits = M[ty] & cols;
      if (ty == oy) bits &= ~(1ULL << ox);
      while (bits) {
        int tx = __builtin_ctzll(bits); bits &= bits - 1;
        double dx = tx + 0.5 - x, d2 = dx * dx + dy * dy;
        if (d2 > (double)R * R) continue;
        int idx = ty * W + tx;
        if (d2 < best || (d2 == best && idx < bi)) { best = d2; bi = idx; *bdx = dx; *bdy = dy; found = 1; }
      }
    }
    if (!any) break;   // row distances only grow with k, so nothing further out can beat the best so far
  }
  if (!found) return -1;
  *bd2 = best; return bi;
}
EXPORT("nearest_test")
double nearest_test(double x, double y, int R, int want) {
  double d2 = 0, dx = 0, dy = 0;
  int ox = (int)x, oy = (int)y;
  int i = nearest(x, y, ox, oy, R, want == 1 ? FM : WM, &d2, &dx, &dy);
  return (double)i;
}

static void sense(int s) {
  float *inp = INP + s * N_IN;
  double x = AX[s], y = AY[s];
  int ox = (int)x, oy = (int)y, idx = oy * W + ox;
  inp[0] = KIND[idx] == 1 ? FOOD[idx] : 0;
  inp[1] = KIND[idx] == 3 ? FOOD[idx] : 0;
  int R = (int)CFG[C_SIGHT];
  double d2, dx, dy;
  if (nearest(x, y, ox, oy, R, FM, &d2, &dx, &dy) >= 0) {
    double d = __builtin_sqrt(d2); if (d == 0) d = 1;
    inp[2] = (float)(dx / d); inp[3] = (float)(dy / d); inp[4] = (float)(1 - d / (R + 1));
  } else { inp[2] = 0; inp[3] = 0; inp[4] = 0; }
  if (nearest(x, y, ox, oy, R, WM, &d2, &dx, &dy) >= 0) {
    double d = __builtin_sqrt(d2); if (d == 0) d = 1;
    inp[5] = (float)(dx / d); inp[6] = (float)(dy / d); inp[7] = (float)(1 - d / (R + 1));
  } else { inp[5] = 0; inp[6] = 0; inp[7] = 0; }
  double e = AE[s] / CFG[C_MAXE], w = AW[s] / CFG[C_MAXW];
  inp[8] = (float)(e < 1 ? e : 1); inp[9] = (float)(w < 1 ? w : 1);
  inp[10] = 1;
  if (CFG[C_MEMORY] != 0) for (int m = 0; m < N_MEM; m++) inp[11 + m] = MEM[s * N_MEM + m];
  if (CFG[C_POSITION] != 0) { inp[15] = (float)((x / W) * 2 - 1); inp[16] = (float)((y / H) * 2 - 1); }
  if (CFG[C_NOISE] != 0) inp[17] = (float)(aux() * 2 - 1);
  if (CFG[C_FEEDBACK] != 0) { inp[18] = (float)ABLK[s]; inp[19] = (float)AEATRES[s]; }
  if (CFG[C_TUMBLE] != 0) {
    if (AHT[s] <= 0) {
      double u, v, q;
      do { u = aux() * 2 - 1; v = aux() * 2 - 1; q = u * u + v * v; } while (q >= 1.0 || q < 1e-12);
      double r = __builtin_sqrt(q); AHX[s] = u / r; AHY[s] = v / r;
      AHT[s] = CFG[C_TUMBLEEVERY] * (0.5 + aux());
    }
    AHT[s] -= 1;
    inp[20] = (float)AHX[s]; inp[21] = (float)AHY[s];
  }
  if (CFG[C_AGE] != 0) inp[22] = (float)(AAGE[s] / (AAGE[s] + 250.0));
}

// ---------- thinking ----------
typedef float v4f __attribute__((vector_size(16), aligned(4)));   // aligned(4): rows start at any float offset
typedef int v4i __attribute__((vector_size(16)));
static inline v4f splat(float x) { v4f v = {x, x, x, x}; return v; }
static inline v4f vtanh(v4f x) {
  v4f hi = splat(7.90531110763549805f), lo = splat(-7.90531110763549805f);
  v4i mh = x > hi, ml = x < lo;
  x = (v4f)(((v4i)hi & mh) | ((v4i)x & ~mh));
  x = (v4f)(((v4i)lo & ml) | ((v4i)x & ~ml));
  v4f x2 = x * x;
  v4f p = splat(-2.76076847742355e-16f);
  p = p * x2 + splat(2.00018790482477e-13f); p = p * x2 + splat(-8.60467152213735e-11f);
  p = p * x2 + splat(5.12229709037114e-08f); p = p * x2 + splat(1.48572235717979e-05f);
  p = p * x2 + splat(6.37261928875436e-04f); p = p * x2 + splat(4.89352455891786e-03f);
  p = p * x;
  v4f q = splat(1.19825839466702e-06f);
  q = q * x2 + splat(1.18534705686654e-04f); q = q * x2 + splat(2.26843463243900e-03f); q = q * x2 + splat(4.89352518554385e-03f);
  return p / q;
}
static float HID1[MAXHID + 4] __attribute__((aligned(16))), HID2[MAXHID + 4] __attribute__((aligned(16))), OUTV[16] __attribute__((aligned(16)));
// out[0..cols) = sum over rows r of x[r] * W[r][0..cols)   (W row-major, row length `stride`), cols a multiple of 4, all in f32
static inline void layer(const float *x, int rows, const float *Wt, int stride, int cols, v4f *acc) {
  int nv = cols >> 2;
  for (int v = 0; v < nv; v++) acc[v] = splat(0);
  for (int r = 0; r < rows; r++) {
    float xr = x[r];
    if (xr == 0) continue;   // a zero input adds nothing
    v4f xv = splat(xr); const v4f *row = (const v4f *)(Wt + r * stride);
    for (int v = 0; v < nv; v++) acc[v] += xv * row[v];
  }
}
static void think(int s) {
  const float *g = G + (u64)s * NW, *inp = INP + s * N_IN;
  float xin[N_IN];
  for (int k = 0; k < NACT; k++) xin[k] = inp[ACT[k]];
  v4f acc[MAXHID / 4 > 3 ? MAXHID / 4 : 3];
  int nvh = HP >> 2;
  layer(xin, NACT, g, HP, HP, acc);
  for (int v = 0; v < nvh; v++) *(v4f *)(HID1 + 4 * v) = vtanh(acc[v]);
  const float *last = HID1;
  if (NL == 2) {
    layer(HID1, NH, g + OFF2, HP, HP, acc);
    for (int v = 0; v < nvh; v++) *(v4f *)(HID2 + 4 * v) = vtanh(acc[v]);
    last = HID2;
  }
  v4f oacc[3];
  layer(last, NH, g + OFFO, OP, OP, oacc);
  for (int v = 0; v < (OP >> 2); v++) *(v4f *)(OUTV + 4 * v) = oacc[v];
  v4f mv = vtanh(*(v4f *)OUTV);
  AMX[s] = mv[0]; AMY[s] = mv[1]; AEAT[s] = OUTV[2] > 0;
  if (NOUT == N_OUT) {   // memory: mem = gate * tanh(value) + (1 - gate) * mem, four registers at once
    v4f nv = vtanh(*(v4f *)(OUTV + 3));
    v4f gate = splat(0.5f) * (splat(1) + vtanh(splat(0.5f) * *(v4f *)(OUTV + 3 + N_MEM)));
    v4f *mem = (v4f *)(MEM + s * N_MEM);
    *mem = gate * nv + (splat(1) - gate) * *mem;
  }
}
EXPORT("think_test") void think_test(int s) { think(s); }
EXPORT("out_ptr") float *out_ptr(void) { return OUTV; }
EXPORT("mx_ptr") double *mx_ptr(void) { return AMX; }

// ---------- one tick ----------
EXPORT("step")
void step(int count) {
  const double lossE = CFG[C_LOSSE], lossW = CFG[C_LOSSW], moveE = CFG[C_MOVEE], moveW = CFG[C_MOVEW];
  const double gainE = CFG[C_GAINE], gainW = CFG[C_GAINW], maxE = CFG[C_MAXE], maxW = CFG[C_MAXW];
  const double reqE = CFG[C_REQE], reqW = CFG[C_REQW], payE = CFG[C_PAYE], payW = CFG[C_PAYW];
  const double kidE = CFG[C_KIDE], kidW = CFG[C_KIDW], stepLen = CFG[C_STEPLEN], inertia = CFG[C_INERTIA];
  const int baseline = CFG[C_BASELINE] != 0, maxPop = (int)CFG[C_MAXPOP], floorN = (int)CFG[C_FLOORN], cooldown = (int)CFG[C_COOLDOWN];
  const double needE = reqE > payE + 1 ? reqE : payE + 1, needW = reqW > payW + 1 ? reqW : payW + 1;
  while (count-- > 0) {
    int nold = NAG, nalive = 0, nkids = 0;
    for (int oi = 0; oi < nold; oi++) {
      int s = ORD[oi];
      AAGE[s]++;
      if (baseline) {
        double u, v, q;
        do { u = 2 * rng() - 1; v = 2 * rng() - 1; q = u * u + v * v; } while (q >= 1.0 || q < 1e-12);
        double r = __builtin_sqrt(q); AMX[s] = u / r; AMY[s] = v / r; AEAT[s] = rng() < 0.2;
      } else { sense(s); think(s); }
      if (!baseline && inertia > 0) {
        double cmx = AEAT[s] ? 0 : AMX[s], cmy = AEAT[s] ? 0 : AMY[s];
        AVX[s] = inertia * AVX[s] + (1 - inertia) * cmx; AVY[s] = inertia * AVY[s] + (1 - inertia) * cmy;
        AMX[s] = AVX[s]; AMY[s] = AVY[s];
      }
      double le = lossE, lw = lossW;
      if (AEAT[s]) {
        ABLK[s] = 0;
        int idx = ((int)AY[s]) * W + (int)AX[s]; double amt = FOOD[idx]; int kd = KIND[idx];
        if (kd == 1) { double v = AE[s] + amt * gainE; if (v > maxE) v = maxE; if (v > AE[s]) AE[s] = v; FOOD[idx] = 0; FM[idx / W] &= ~(1ULL << (idx % W)); }
        else if (kd == 3) { double v = AW[s] + amt * gainW; if (v > maxW) v = maxW; if (v > AW[s]) AW[s] = v; FOOD[idx] = 0; WM[idx / W] &= ~(1ULL << (idx % W)); }
        AEATRES[s] = ((kd == 1 || kd == 3) && amt > 0.001) ? amt : -1;
      } else {
        AEATRES[s] = 0;
        double mx = AMX[s], my = AMY[s], len = __builtin_sqrt(mx * mx + my * my), speed = len < 1 ? len : 1;
        if (speed > 0.05) {
          double dist = speed * stepLen, px = AX[s], py = AY[s];
          double nx = px + mx / len * dist, ny = py + my / len * dist;
          double cx = nx < 0 ? 0 : (nx > W - 0.001 ? W - 0.001 : nx), cy = ny < 0 ? 0 : (ny > H - 0.001 ? H - 0.001 : ny);
          AX[s] = cx; AY[s] = cy;
          if (cx != nx) AVX[s] = 0;
          if (cy != ny) AVY[s] = 0;
          double mv = __builtin_sqrt((cx - px) * (cx - px) + (cy - py) * (cy - py)) / dist;
          ABLK[s] = 1 - mv > 0 ? 1 - mv : 0;
          le += moveE * speed; lw += moveW * speed;
        } else ABLK[s] = 0;
      }
      AE[s] -= le; AW[s] -= lw;
      if (ACD[s] > 0) ACD[s]--;
      if (AE[s] <= 0) { STARVED++; FREE[NFREE++] = s; continue; }
      if (AW[s] <= 0) { THIRSTY++; FREE[NFREE++] = s; continue; }
      if (ACD[s] <= 0 && AE[s] >= needE && AW[s] >= needW && nold + nkids < maxPop) {
        AE[s] -= payE; AW[s] -= payW; ACD[s] = cooldown;
        int c = mutate_child(s); AE[c] = kidE; AW[c] = kidW; ACD[c] = 0;
        KIDS[nkids++] = c; BORN++;
      }
      ORD2[nalive++] = s;
    }
    for (int k = 0; k < nkids; k++) ORD2[nalive++] = KIDS[k];
    for (int k = 0; k < nalive; k++) ORD[k] = ORD2[k];
    NAG = nalive;
    while (NAG < floorN) ORD[NAG++] = random_agent();
    const double rf = CFG[C_REGROW], rw = CFG[C_WREGROW];
    for (int k = 0; k < NFERT; k++) {
      int i = FERTILE[k];
      float old = FOOD[i];
      if (old < 1) {
        double nv = (double)old + (KIND[i] == 3 ? rw : rf) * (double)FERT[i];
        if (nv > 1) nv = 1;
        FOOD[i] = (float)nv;
        if ((double)old < MIN_SEE && (double)FOOD[i] >= MIN_SEE) {
          if (KIND[i] == 1) FM[i / W] |= 1ULL << (i % W);
          else if (KIND[i] == 3) WM[i / W] |= 1ULL << (i % W);
        }
      }
    }
    TICK++;
  }
}
