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
//   - generational mode (gen_init / gen_round): fixed-size rounds, tournament selection, elitism, optional crossover
//   - not supported: food relocation (shiftEvery), the "newcomers copy parents" archive, mixed/split maps
// Build: see build.sh. Config layout: keep CFG_KEYS in engine.js in the same order as enum Cfg.

typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned long long u64;
#define EXPORT(n) __attribute__((export_name(n)))

#define W 64
#define H 64
#define N_IN 37
#define N_MEM 4
#define N_OUT (3 + 2 * N_MEM)
#define MAXHID 32
#define MAXA 2048
#define MAXG (N_IN * MAXHID + MAXHID * MAXHID + MAXHID * 24 + 4)   // input-major layers, columns padded to a multiple of 4
#define MIN_SEE 0.2

enum Cfg {
  C_REGROW, C_WREGROW, C_LOSSE, C_LOSSW, C_MOVEE, C_MOVEW, C_GAINE, C_GAINW, C_MAXE, C_MAXW,
  C_STARTE, C_STARTW, C_REQE, C_REQW, C_PAYE, C_PAYW, C_KIDE, C_KIDW, C_STEPLEN, C_COOLDOWN,
  C_SIGHT, C_HIDDEN, C_LAYERS, C_MEMORY, C_POSITION, C_NOISE, C_AGE, C_FEEDBACK, C_TUMBLE,
  C_TUMBLEEVERY, C_INERTIA, C_MUTRATE, C_MUTSIZE, C_BASELINE, C_FLOORN, C_MAXPOP, C_BRAINMOM, C_GENP, C_GENLEN, C_GENELITE, C_GENTOURN, C_GENXOVER, C_GENSPAWN, C_GWSURV, C_GWFOOD, C_GWWATER, C_GSCOREMODE, C_OSC, C_LATCH, C_OSCPERIOD, C_AGESCALE, C_AGETHERM, C_THERMMODE, C_OSCGENE, C_TIMER, C_GENEMUT, C_WALLSENSE, C_MEMFREEZE, C_MEMNOISE, C_COUNT
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
static u64 FM[H], WM[H], WLM[H];            // per row: bit x set when a food / water tile there has at least MIN_SEE
static int FERTILE[W * H], NFERT;
EXPORT("kind_ptr") u8 *kind_ptr(void) { return KIND; }
EXPORT("fert_ptr") float *fert_ptr(void) { return FERT; }
EXPORT("food_ptr") float *food_ptr(void) { return FOOD; }

static void rebuild_masks(void) {
  for (int y = 0; y < H; y++) { FM[y] = 0; WM[y] = 0; WLM[y] = 0; }
  NFERT = 0;
  for (int i = 0; i < W * H; i++) {
    if (KIND[i] == 4) WLM[i / W] |= 1ULL << (i % W);   // wall tiles block movement; the wall sense looks for these
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
static double ATMR[MAXA], APER[MAXA], ATH[MAXA][6], APH[MAXA], ALAT[MAXA][2], AGRIP[MAXA], ABLK[MAXA], AEATRES[MAXA], AHX[MAXA], AHY[MAXA], AHT[MAXA];
static int ACD[MAXA], AAGE[MAXA], AGEN[MAXA], AEAT[MAXA];
// generational mode
#define MAXGP 1000
static int GENMODE, GP, GEN, ROUNDTICK, GDEAD[MAXA];
static double GFOOD[MAXA], GWATER[MAXA], GKEY[MAXA], GSTATS[24];
static u8 GVIS[MAXA];   // bit 0: stood on water, bit 1: on food circle A, bit 2: on food circle B
static float G2[(u64)MAXGP * MAXG];
static int ORD[MAXA], ORD2[MAXA], FREE[MAXA], KIDS[MAXA], NFREE, NAG;
static int NH, NL, NW, ACT[N_IN], NACT, HP, OP, NOUT, GRIPIDX, LATIDX, OSCIDX, THIDX, TMRIDX, GENEOFF, OFF2, OFFO, NREAL, REAL[MAXG];
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
EXPORT("gene_off") int gene_off(void) { return GENEOFF; }
EXPORT("act_ptr") int *act_ptr(void) { return ACT; }

static void setup_brain(void) {
  NH = (int)CFG[C_HIDDEN]; NL = (int)CFG[C_LAYERS];
  HP = (NH + 3) & ~3; NOUT = CFG[C_MEMORY] != 0 ? N_OUT : 3;
  // extra outputs come after the memory outputs (or after eat when memory is off), in this order when enabled: momentum, latch trigger, oscillator period
  GRIPIDX = NOUT; if (CFG[C_BRAINMOM] != 0) NOUT += 1;
  LATIDX = NOUT; if (CFG[C_LATCH] != 0) NOUT += 1;
  OSCIDX = NOUT; if (CFG[C_OSC] != 0 && CFG[C_OSCPERIOD] <= 0 && CFG[C_OSCGENE] == 0) NOUT += 1;   // oscPeriod > 0 or oscGene: the period is not a brain output
  THIDX = NOUT; if (CFG[C_AGETHERM] != 0) NOUT += CFG[C_THERMMODE] == 1 ? 1 : CFG[C_THERMMODE] == 2 ? 6 : 0;   // thermMode 1: one scale output; 2: one output per step
  OP = (NOUT + 3) & ~3;
  NACT = 0;
  for (int i = 0; i < N_IN; i++) {
    int on = 1;
    if (i >= 11 && i <= 14) on = CFG[C_MEMORY] != 0;
    else if (i == 15 || i == 16) on = CFG[C_POSITION] != 0;
    else if (i == 17) on = CFG[C_NOISE] != 0;
    else if (i == 18 || i == 19) on = CFG[C_FEEDBACK] != 0;
    else if (i == 20 || i == 21) on = CFG[C_TUMBLE] != 0;
    else if (i == 22) on = CFG[C_AGE] != 0;
    else if (i == 23 || i == 24) on = CFG[C_OSC] != 0;
    else if (i == 25 || i == 26) on = CFG[C_LATCH] != 0;
    else if (i >= 27 && i <= 32) on = CFG[C_AGETHERM] != 0;
    else if (i == 33) on = CFG[C_TIMER] != 0;
    else if (i >= 34 && i <= 36) on = CFG[C_WALLSENSE] != 0;
    if (on) ACT[NACT++] = i;
  }
  TMRIDX = NOUT; if (CFG[C_TIMER] != 0) NOUT += 1;   // resettable timer: one output, above 0 resets it
  OP = (NOUT + 3) & ~3;
  OFF2 = NACT * HP; OFFO = OFF2 + (NL == 2 ? NH * HP : 0); GENEOFF = OFFO + NH * OP; NW = GENEOFF + (CFG[C_OSCGENE] != 0 ? 1 : 0);   // the clock gene is one extra number at the end of the genome
  NREAL = 0;   // offsets of the weights that exist (the padding columns stay 0)
  for (int k = 0; k < NACT; k++) for (int c = 0; c < NH; c++) REAL[NREAL++] = k * HP + c;
  if (NL == 2) for (int j = 0; j < NH; j++) for (int c = 0; c < NH; c++) REAL[NREAL++] = OFF2 + j * HP + c;
  for (int h = 0; h < NH; h++) for (int o = 0; o < NOUT; o++) REAL[NREAL++] = OFFO + h * OP + o;
}

static int alloc_slot(void) { return FREE[--NFREE]; }
static void mutate_gene(float *g);

static void random_genome(float *g);
static void new_agent(int s, double x, double y, int gen) {
  AX[s] = x; AY[s] = y; AE[s] = CFG[C_STARTE]; AW[s] = CFG[C_STARTW];
  AVX[s] = AVY[s] = AMX[s] = AMY[s] = 0; ABLK[s] = AEATRES[s] = 0; AHX[s] = AHY[s] = 0; AHT[s] = 0;
  for (int k = 0; k < 6; k++) ATH[s][k] = 50 << k;
  ATMR[s] = 0; APH[s] = 0; ALAT[s][0] = ALAT[s][1] = 0;
  if (CFG[C_LATCH] != 0) { ALAT[s][0] = aux() * 2 - 1; ALAT[s][1] = aux() * 2 - 1; }   // a latch starts holding a random sample
  AGRIP[s] = 0; ACD[s] = 0; AAGE[s] = 0; AGEN[s] = gen; AEAT[s] = 0;
  for (int m = 0; m < N_MEM; m++) MEM[s * N_MEM + m] = 0;
}
static int random_agent(void) {
  int s = alloc_slot(); float *g = G + (u64)s * NW;
  random_genome(g);
  double x = rng() * W, y = rng() * H;
  new_agent(s, x, y, 0);
  return s;
}
static int mutate_child(int p) {
  int s = alloc_slot(); float *g = G + (u64)s * NW; const float *pg = G + (u64)p * NW;
  double mr = CFG[C_MUTRATE], ms = CFG[C_MUTSIZE];
  for (int i = 0; i < NW; i++) g[i] = pg[i];
  for (int k = 0; k < NREAL; k++) if (rng() < mr) g[REAL[k]] = (float)((double)g[REAL[k]] + gauss() * ms);
  mutate_gene(g);
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

// sin(2*pi*x) from a polynomial (no libm here); x is any real number
static inline double sin2pi(double x) {
  x -= (double)(long long)x; if (x < 0) x += 1;          // [0, 1)
  double t = (x - 0.5) * 6.283185307179586;                // [-pi, pi): sin(2*pi*x) = -sin(t)
  const double half = 1.5707963267948966;
  if (t > half) t = 3.141592653589793 - t; else if (t < -half) t = -3.141592653589793 - t;
  double t2 = t * t, r = t * (1 + t2 * (-1.0 / 6 + t2 * (1.0 / 120 + t2 * (-1.0 / 5040 + t2 * (1.0 / 362880)))));
  return -r;
}
EXPORT("sin2pi_test") double sin2pi_test(double x) { return sin2pi(x); }

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
  if (CFG[C_MEMORY] == 0) { for (int m = 0; m < N_MEM; m++) inp[11 + m] = 0; }   // memory switched off after training (ablation): the registers read 0
  else if (CFG[C_MEMNOISE] != 0) { for (int m = 0; m < N_MEM; m++) { double u = aux(); inp[11 + m] = (float)(u < 0.3 ? -1 : u < 0.6 ? 1 : (aux() * 2 - 1)); } }   // ablation: the registers are replaced by fresh noise every tick (30% -1, 30% +1, 40% uniform), about the distribution the trained registers show
  else { for (int m = 0; m < N_MEM; m++) inp[11 + m] = MEM[s * N_MEM + m]; }
  // a switched-off feature writes 0, so an ablation (feature switched off after training, brain unchanged) feeds 0 rather than the last value
  if (CFG[C_POSITION] != 0) { inp[15] = (float)((x / W) * 2 - 1); inp[16] = (float)((y / H) * 2 - 1); } else { inp[15] = 0; inp[16] = 0; }
  if (CFG[C_NOISE] != 0) inp[17] = (float)(aux() * 2 - 1); else inp[17] = 0;
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
  } else { inp[20] = 0; inp[21] = 0; }
  if (CFG[C_AGE] != 0) {   // ageScale > 0: linear age / ageScale capped at 1; otherwise the saturating age / (age + 250)
    double a = AAGE[s];
    inp[22] = (float)(CFG[C_AGESCALE] > 0 ? (a < CFG[C_AGESCALE] ? a / CFG[C_AGESCALE] : 1.0) : a / (a + 250.0));
  } else inp[22] = 0;
  if (CFG[C_OSC] != 0) { inp[23] = (float)sin2pi(APH[s]); inp[24] = (float)sin2pi(APH[s] + 0.25); } else { inp[23] = 0; inp[24] = 0; }
  if (CFG[C_LATCH] != 0) { inp[25] = (float)ALAT[s][0]; inp[26] = (float)ALAT[s][1]; } else { inp[25] = 0; inp[26] = 0; }
  if (CFG[C_TIMER] != 0) { double v = mylog(1 + ATMR[s]) * 1.4426950408889634 / 11; inp[33] = (float)(v < 1 ? v : 1); } else inp[33] = 0;   // log2(1 + ticks since reset) / 11, so it covers about 2000 ticks without a hand-picked scale
  if (CFG[C_WALLSENSE] != 0) {   // nearest wall tile within sight: direction and closeness, like food and water
    if (nearest(x, y, ox, oy, R, WLM, &d2, &dx, &dy) >= 0) {
      double d = __builtin_sqrt(d2); if (d == 0) d = 1;
      inp[34] = (float)(dx / d); inp[35] = (float)(dy / d); inp[36] = (float)(1 - d / (R + 1));
    } else { inp[34] = 0; inp[35] = 0; inp[36] = 0; }
  } else { inp[34] = 0; inp[35] = 0; inp[36] = 0; }
  // thermometer: on once the dot is old enough; thresholds are 50, 100, 200, 400, 800, 1600 unless the brain sets them
  if (CFG[C_AGETHERM] != 0) for (int k = 0; k < 6; k++) inp[27 + k] = AAGE[s] >= ATH[s][k] ? 1.0f : 0.0f;
  else for (int k = 0; k < 6; k++) inp[27 + k] = 0;
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
// 2^x for x between about 0 and 12 (no libm in this build)
static inline double pow2(double x) {
  if (x < 0) x = 0; if (x > 12) x = 12;
  int ei = (int)x; double fr = x - ei, p = 1 + fr * (0.6931471805599453 + fr * (0.2402265069591007 + fr * (0.05550410866482158 + fr * (0.009618129107628477 + fr * 0.0013333558146428443))));
  return p * (double)(1 << ei);
}
EXPORT("pow2_test") double pow2_test(double x) { return pow2(x); }
static float HID1[MAXHID + 4] __attribute__((aligned(16))), HID2[MAXHID + 4] __attribute__((aligned(16))), OUTV[32] __attribute__((aligned(16)));
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
  v4f oacc[6];
  layer(last, NH, g + OFFO, OP, OP, oacc);
  for (int v = 0; v < (OP >> 2); v++) *(v4f *)(OUTV + 4 * v) = oacc[v];
  v4f mv = vtanh(*(v4f *)OUTV);
  AMX[s] = mv[0]; AMY[s] = mv[1]; AEAT[s] = OUTV[2] > 0;
  if (CFG[C_BRAINMOM] != 0) AGRIP[s] = 0.95 * 0.5 * (1 + ftanh(0.5 * OUTV[GRIPIDX]));
  if (CFG[C_LATCH] != 0 && OUTV[LATIDX] > 0) { ALAT[s][0] = aux() * 2 - 1; ALAT[s][1] = aux() * 2 - 1; }   // trigger: take a new random sample, otherwise hold
  if (CFG[C_TIMER] != 0) { if (OUTV[TMRIDX] > 0) ATMR[s] = 0; else ATMR[s] += 1; }
  if (CFG[C_AGETHERM] != 0) {   // brain-set thermometer, applies from the next tick
    if (CFG[C_THERMMODE] == 1) {   // one output sets the unit u = 12.5 * 16^sigmoid (12.5 to 200 ticks); steps at u * 1, 2, 4, 8, 16, 32
      double sg = 0.5 * (1 + ftanh(0.5 * OUTV[THIDX])), u = 12.5, base = 16;
      // 16^sg = exp(sg * ln 16) via 2^(4 sg): split into integer and fractional powers of 2
      double e4 = 4 * sg; int ei = (int)e4; double fr = e4 - ei, p2 = 1 + fr * (0.6931471805599453 + fr * (0.2402265069591007 + fr * (0.05550410866482158 + fr * (0.009618129107628477 + fr * 0.0013333558146428443))));
      (void)base; u *= p2 * (double)(1 << ei);
      for (int k = 0; k < 6; k++) ATH[s][k] = u * (double)(1 << k);
    } else if (CFG[C_THERMMODE] == 2) {   // each step's threshold is chosen by its own output: 10 * 200^sigmoid (10 to 2000 ticks)
      for (int k = 0; k < 6; k++) {
        double sg = 0.5 * (1 + ftanh(0.5 * OUTV[THIDX + k])), e = sg * 7.643856189774724;   // log2(200)
        int ei = (int)e; double fr = e - ei, p2 = 1 + fr * (0.6931471805599453 + fr * (0.2402265069591007 + fr * (0.05550410866482158 + fr * (0.009618129107628477 + fr * 0.0013333558146428443))));
        ATH[s][k] = 10 * p2 * (double)(1 << ei);
      }
    }
  }
  if (CFG[C_OSC] != 0) {
    double per = CFG[C_OSCPERIOD] > 0 ? CFG[C_OSCPERIOD] : CFG[C_OSCGENE] != 0 ? pow2(G[(u64)s * NW + GENEOFF]) : 4 + 396 * 0.5 * (1 + ftanh(0.5 * OUTV[OSCIDX]));
    APER[s] = per; APH[s] += 1.0 / per;
  }   // the brain sets the period (4 to 400 ticks), or it is fixed by oscPeriod
  if (CFG[C_MEMORY] != 0 && !(CFG[C_MEMFREEZE] > 0 && AAGE[s] > CFG[C_MEMFREEZE])) {   // memFreeze (ablation): from that age on the registers keep their value; memory: mem = gate * tanh(value) + (1 - gate) * mem, four registers at once
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
static inline void mark_visit(int s) {
  int kd = KIND[((int)AY[s]) * W + (int)AX[s]];
  if (kd == 3) GVIS[s] |= 1;
  else if (kd == 1) {
    double dx = AX[s] - W * 0.75, dy = AY[s] - H * 0.25;
    if (dx * dx + dy * dy <= 81) GVIS[s] |= 2;
    else { dx = AX[s] - W * 0.25; dy = AY[s] - H * 0.75; if (dx * dx + dy * dy <= 81) GVIS[s] |= 4; }
  }
}

EXPORT("step")
void step(int count) {
  const double lossE = CFG[C_LOSSE], lossW = CFG[C_LOSSW], moveE = CFG[C_MOVEE], moveW = CFG[C_MOVEW];
  const double gainE = CFG[C_GAINE], gainW = CFG[C_GAINW], maxE = CFG[C_MAXE], maxW = CFG[C_MAXW];
  const double reqE = CFG[C_REQE], reqW = CFG[C_REQW], payE = CFG[C_PAYE], payW = CFG[C_PAYW];
  const double kidE = CFG[C_KIDE], kidW = CFG[C_KIDW], stepLen = CFG[C_STEPLEN], inertia = CFG[C_INERTIA];
  const int brainMom = CFG[C_BRAINMOM] != 0, baseline = CFG[C_BASELINE] != 0, maxPop = (int)CFG[C_MAXPOP], floorN = (int)CFG[C_FLOORN], cooldown = (int)CFG[C_COOLDOWN];
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
      if (!baseline && (brainMom || inertia > 0)) {
        double al = brainMom ? AGRIP[s] : inertia;
        double cmx = AEAT[s] ? 0 : AMX[s], cmy = AEAT[s] ? 0 : AMY[s];
        AVX[s] = al * AVX[s] + (1 - al) * cmx; AVY[s] = al * AVY[s] + (1 - al) * cmy;
        AMX[s] = AVX[s]; AMY[s] = AVY[s];
      }
      double le = lossE, lw = lossW;
      if (AEAT[s]) {
        ABLK[s] = 0;
        int idx = ((int)AY[s]) * W + (int)AX[s]; double amt = FOOD[idx]; int kd = KIND[idx];
        if (kd == 1) { double v = AE[s] + amt * gainE; if (v > maxE) v = maxE; if (v > AE[s]) AE[s] = v; GFOOD[s] += amt * gainE; FOOD[idx] = 0; FM[idx / W] &= ~(1ULL << (idx % W)); }
        else if (kd == 3) { double v = AW[s] + amt * gainW; if (v > maxW) v = maxW; if (v > AW[s]) AW[s] = v; GWATER[s] += amt * gainW; FOOD[idx] = 0; WM[idx / W] &= ~(1ULL << (idx % W)); }
        AEATRES[s] = ((kd == 1 || kd == 3) && amt > 0.001) ? amt : -1;
      } else {
        AEATRES[s] = 0;
        double mx = AMX[s], my = AMY[s], len = __builtin_sqrt(mx * mx + my * my), speed = len < 1 ? len : 1;
        if (speed > 0.05) {
          double dist = speed * stepLen, px = AX[s], py = AY[s];
          double nx = px + mx / len * dist, ny = py + my / len * dist;
          double cx = nx < 0 ? 0 : (nx > W - 0.001 ? W - 0.001 : nx), cy = ny < 0 ? 0 : (ny > H - 0.001 ? H - 0.001 : ny);
          if (KIND[((int)cy) * W + (int)cx] == 4) {   // a wall tile: slide along it (keep one axis), or stay if both are walls
            if (KIND[((int)py) * W + (int)cx] != 4) cy = py;
            else if (KIND[((int)cy) * W + (int)px] != 4) cx = px;
            else { cx = px; cy = py; }
          }
          AX[s] = cx; AY[s] = cy;
          if (cx != nx) AVX[s] = 0;
          if (cy != ny) AVY[s] = 0;
          double mv = __builtin_sqrt((cx - px) * (cx - px) + (cy - py) * (cy - py)) / dist;
          ABLK[s] = 1 - mv > 0 ? 1 - mv : 0;
          le += moveE * speed; lw += moveW * speed;
        } else ABLK[s] = 0;
      }
      if (GENMODE) mark_visit(s);
      AE[s] -= le; AW[s] -= lw;
      if (ACD[s] > 0) ACD[s]--;
      if (AE[s] <= 0) { STARVED++; if (GENMODE) GDEAD[s] = ROUNDTICK + 1; else FREE[NFREE++] = s; continue; }
      if (AW[s] <= 0) { THIRSTY++; if (GENMODE) GDEAD[s] = ROUNDTICK + 1; else FREE[NFREE++] = s; continue; }
      if (!GENMODE && ACD[s] <= 0 && AE[s] >= needE && AW[s] >= needW && nold + nkids < maxPop) {
        AE[s] -= payE; AW[s] -= payW; ACD[s] = cooldown;
        int c = mutate_child(s); AE[c] = kidE; AW[c] = kidW; ACD[c] = 0;
        KIDS[nkids++] = c; BORN++;
      }
      ORD2[nalive++] = s;
    }
    for (int k = 0; k < nkids; k++) ORD2[nalive++] = KIDS[k];
    for (int k = 0; k < nalive; k++) ORD[k] = ORD2[k];
    NAG = nalive;
    if (!GENMODE) while (NAG < floorN) ORD[NAG++] = random_agent();
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

// ---------- generational mode ----------
static void random_genome(float *g) {
  for (int i = 0; i < NW; i++) g[i] = 0;
  for (int k = 0; k < NREAL; k++) g[REAL[k]] = (float)(gauss() * 0.5);
  if (CFG[C_OSCGENE] != 0) g[GENEOFF] = (float)(3 + rng() * 6.64);   // clock gene: log2 of the period, 8 to 800 ticks at the start
}
static void mutate_gene(float *g) {
  if (CFG[C_OSCGENE] == 0) return;
  double v = (double)g[GENEOFF] + gauss() * CFG[C_GENEMUT];   // sd in log2 units: 0.25 is about a 19% change in the period per generation
  g[GENEOFF] = (float)(v < 2 ? 2 : v > 10 ? 10 : v);
}
static void mutate_genome(float *g) {
  double mr = CFG[C_MUTRATE], ms = CFG[C_MUTSIZE];
  for (int k = 0; k < NREAL; k++) if (rng() < mr) g[REAL[k]] = (float)((double)g[REAL[k]] + gauss() * ms);
  mutate_gene(g);
}
// child = mix of parents a and b. mode 1: whole hidden neurons from one parent (neuron h owns its layer-1 column,
// its layer-2 row when there are two layers, and its output row); mode 2: every weight from one parent at random.
static void crossover(float *child, const float *A, const float *B, int mode) {
  for (int i = 0; i < NW; i++) child[i] = 0;
  if (CFG[C_OSCGENE] != 0) child[GENEOFF] = rng() < 0.5 ? A[GENEOFF] : B[GENEOFF];
  if (mode == 2) {
    for (int k = 0; k < NREAL; k++) child[REAL[k]] = rng() < 0.5 ? A[REAL[k]] : B[REAL[k]];
    return;
  }
  for (int h = 0; h < NH; h++) {
    const float *src = rng() < 0.5 ? A : B;
    for (int k = 0; k < NACT; k++) child[k * HP + h] = src[k * HP + h];
    if (NL == 2) for (int c2 = 0; c2 < HP; c2++) child[OFF2 + h * HP + c2] = src[OFF2 + h * HP + c2];
    for (int o = 0; o < OP; o++) child[OFFO + h * OP + o] = src[OFFO + h * OP + o];
  }
}
EXPORT("cross_test") void cross_test(int a, int b, int mode, int out) { crossover(G + (u64)out * NW, G + (u64)a * NW, G + (u64)b * NW, mode); }

EXPORT("gen_init")
void gen_init(u32 seed) {
  setup_brain();
  rs = seed; as = seed * 7919u + 13u;
  GENMODE = 1; GEN = 0; TICK = 0; BORN = 0; STARVED = 0; THIRSTY = 0;
  GP = (int)CFG[C_GENP]; if (GP > MAXGP) GP = MAXGP; if (GP < 2) GP = 2;
  for (int s = 0; s < GP; s++) random_genome(G + (u64)s * NW);
}
static int tournament(int T) {
  int best = -1;
  for (int j = 0; j < T; j++) { int i = (int)(rng() * GP); if (best < 0 || GKEY[i] > GKEY[best]) best = i; }
  return best;
}
// runs one round on the current genomes, records GSTATS for it, then breeds the next generation in place
EXPORT("gen_begin")
void gen_begin(void) {
  for (int i = 0; i < W * H; i++) FOOD[i] = FERT[i];
  rebuild_masks();
  NAG = GP; TICK = 0;
  for (int s = 0; s < GP; s++) {
    ORD[s] = s;
    if (CFG[C_GENSPAWN] == 1) new_agent(s, W * 0.5, H * 0.5, 0);   // everyone starts in the centre
    else { double x = rng() * W, y = rng() * H; new_agent(s, x, y, 0); }
    GDEAD[s] = -1; GFOOD[s] = 0; GWATER[s] = 0; GVIS[s] = 0;
  }
}
EXPORT("gen_tick") int gen_tick(int t) { ROUNDTICK = t; step(1); return NAG; }
static int idx[MAXGP];   // dot slots sorted by GKEY, best first
static void sort_by_key(void) {
  for (int s = 0; s < GP; s++) idx[s] = s;
  for (int i = 1; i < GP; i++) { int v = idx[i], j = i - 1; while (j >= 0 && GKEY[idx[j]] < GKEY[v]) { idx[j + 1] = idx[j]; j--; } idx[j + 1] = v; }
}
static void breed_next(void);
EXPORT("gen_end")
void gen_end(int breed) {
  const int L = (int)CFG[C_GENLEN];
  // scores: key = wSurv * ticks survived + wFood * food tiles eaten + wWater * water tiles drunk (+ a tiny tie-break on total intake)
  const double wS = CFG[C_GWSURV], wF = CFG[C_GWFOOD], wW = CFG[C_GWWATER], gE = CFG[C_GAINE] > 0 ? CFG[C_GAINE] : 1, gW = CFG[C_GAINW] > 0 ? CFG[C_GAINW] : 1;
  double sumSurv = 0, sumF = 0, sumW = 0, sumKey = 0; int full = 0, pond = 0, both = 0, drank = 0;
  for (int s = 0; s < GP; s++) {
    double surv = GDEAD[s] < 0 ? (double)L : (double)GDEAD[s], ft = GFOOD[s] / gE, wt = GWATER[s] / gW;
    if (CFG[C_GSCOREMODE] == 1) {   // both are needed: score = the smaller of the weighted food and water totals (plus a small survival term)
      double a = wF * ft, b = wW * wt;
      GKEY[s] = (a < b ? a : b) + wS * surv * 1e-3 + (GFOOD[s] + GWATER[s]) * 1e-6;
    } else GKEY[s] = wS * surv + wF * ft + wW * wt + (GFOOD[s] + GWATER[s]) * 1e-6;
    sumSurv += surv; sumF += ft; sumW += wt; sumKey += GKEY[s];
    if (GDEAD[s] < 0) full++;
    if (GVIS[s] & 1) pond++;
    if (GWATER[s] > 0) drank++;
    if ((GVIS[s] & 6) == 6) both++;
  }
  sort_by_key();
  double diff = 0; int pairs = 0;
  for (int i = 0; i < 100 && i < GP; i++) {
    const float *a = G + (u64)i * NW, *b = G + (u64)((i * 7 + 3) % GP) * NW; double d = 0;
    for (int k = 0; k < NREAL; k++) { double e2 = (double)a[REAL[k]] - (double)b[REAL[k]]; d += e2 < 0 ? -e2 : e2; }
    diff += d / NREAL; pairs++;
  }
  GSTATS[0] = GEN;
  GSTATS[1] = GKEY[idx[0]];
  GSTATS[2] = sumSurv / GP;               // mean ticks survived
  GSTATS[3] = GKEY[idx[GP / 2]];
  GSTATS[4] = (double)full / GP;
  GSTATS[5] = sumF / GP; GSTATS[6] = sumW / GP;   // mean food tiles eaten, water tiles drunk
  GSTATS[7] = (double)pond / GP; GSTATS[8] = (double)both / GP;
  GSTATS[9] = pairs ? diff / pairs : 0;
  GSTATS[10] = NAG;
  GSTATS[11] = sumKey / GP;               // mean score
  GSTATS[12] = (double)drank / GP;        // share that drank at least once
  if (!breed) return;   // evaluation only: leave the genomes as they are
  breed_next();
}
// next generation from the current GKEY (idx must be sorted by GKEY), bred into G2 then copied back
static void breed_next(void) {
  const int E = (int)CFG[C_GENELITE], T = (int)CFG[C_GENTOURN], X = (int)CFG[C_GENXOVER];
  for (int c = 0; c < GP; c++) {
    float *g = G2 + (u64)c * NW;
    if (c < E) { const float *p = G + (u64)idx[c] * NW; for (int i = 0; i < NW; i++) g[i] = p[i]; continue; }
    int a = tournament(T);
    if (X) { int b = tournament(T); crossover(g, G + (u64)a * NW, G + (u64)b * NW, X); }
    else { const float *p = G + (u64)a * NW; for (int i = 0; i < NW; i++) g[i] = p[i]; }
    mutate_genome(g);
  }
  for (int c = 0; c < GP; c++) { float *g = G + (u64)c * NW; const float *p = G2 + (u64)c * NW; for (int i = 0; i < NW; i++) g[i] = p[i]; }
  GEN++;
}
// scoring on several layouts: run rounds with gen_round_ex(0), average GKEY over them in JavaScript (gkey_ptr), write the mean back, then gen_breed()
EXPORT("gkey_ptr") double *gkey_ptr(void) { return GKEY; }
EXPORT("gen_breed") void gen_breed(void) { sort_by_key(); breed_next(); }
EXPORT("gen_stats_ptr") double *gen_stats_ptr(void) { return GSTATS; }
EXPORT("gen_index") int gen_index(void) { return GEN; }
EXPORT("gen_round_ex") void gen_round_ex(int breed) { gen_begin(); const int L = (int)CFG[C_GENLEN]; for (int t = 0; t < L && NAG > 0; t++) gen_tick(t); gen_end(breed); }
EXPORT("gen_round") void gen_round(void) { gen_round_ex(1); }
// state exports for the trace tool
EXPORT("ae_ptr") double *ae_ptr(void) { return AE; }
EXPORT("aw_ptr") double *aw_ptr(void) { return AW; }
EXPORT("ablk_ptr") double *ablk_ptr(void) { return ABLK; }
EXPORT("aper_ptr") double *aper_ptr(void) { return APER; }
EXPORT("gfood_ptr") double *gfood_ptr(void) { return GFOOD; }
EXPORT("gwater_ptr") double *gwater_ptr(void) { return GWATER; }
EXPORT("gdead_ptr") int *gdead_ptr(void) { return GDEAD; }