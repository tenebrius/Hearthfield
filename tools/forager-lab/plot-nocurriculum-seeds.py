import re,collections
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
def load(path, key):
    d={}
    for l in open(path):
        if ' FINAL ' not in l: continue
        p=l.split()
        if key(p) is None: continue
        d[key(p)]={k:int(v) for k,v in re.findall(r'(TEST_\w+) (\d+)',l)}
    return d
A=load('docs/forager-lab-ablation-raw.txt', lambda p: int(p[1][1:]) if p[0]=='none' else None)
B=load('docs/forager-lab-nocurriculum-raw.txt', lambda p: int(p[1][1:]) if p[0]=='g1500' else None)
seeds=range(1,9)
bg,ink,ink2,grid='#fcfcfb','#0b0b0b','#52514e','#e4e3df'; c1,c2='#2a78d6','#eb6834'
plt.rcParams.update({'font.family':'DejaVu Sans','text.color':ink,'axes.labelcolor':ink2,'xtick.color':ink2,'ytick.color':ink2})
fig,axs=plt.subplots(1,2,figsize=(12.5,5.4),facecolor=bg)
w=0.38
for ax,key,title,yl in [(axs[0],'TEST_BARS_DRANK','Drank on cup maps (% of dots)',(0,100)),(axs[1],'TEST_BARS_TICKS','Ticks survived on cup maps (of 1000)',(600,1000))]:
    ax.set_facecolor(bg)
    for i,s in enumerate(seeds):
        a,b=A[s][key],B[s][key]
        ax.bar(i-w/2-0.01,a-(yl[0] if key.endswith('TICKS') else 0),w,bottom=yl[0] if key.endswith('TICKS') else 0,color=c1,label='Pond stages kept' if i==0 else None)
        ax.bar(i+w/2+0.01,b-(yl[0] if key.endswith('TICKS') else 0),w,bottom=yl[0] if key.endswith('TICKS') else 0,color=c2,label='No curriculum' if i==0 else None)
    ax.set_xticks(range(8)); ax.set_xticklabels([f'seed {s}' for s in seeds],fontsize=9)
    ax.set_ylim(*yl); ax.set_title(title,loc='left',fontsize=12,color=ink,pad=10)
    ax.grid(axis='y',color=grid,lw=0.8); ax.set_axisbelow(True)
    for sp in ['top','right','left']: ax.spines[sp].set_visible(False)
    ax.spines['bottom'].set_color(grid); ax.tick_params(length=0)
axs[0].legend(frameon=False,loc='upper center',bbox_to_anchor=(0.5,1.0),ncol=2,fontsize=10,labelcolor=ink2)
# thirst wall + failure notes
axs[1].axhline(833,color=ink2,lw=1.2,ls=(0,(4,3)),label='833 ticks: a dot that never drinks (thirst wall)')
h=[l for l in axs[1].get_lines()]
axs[1].legend(handles=h,frameon=False,loc='upper center',bbox_to_anchor=(0.5,1.0),fontsize=10,labelcolor=ink2)
for i,s in enumerate(seeds):
    if B[s]['TEST_BARS_DRANK']==0:
        axs[0].text(i+w/2+0.01,2,'0%',ha='center',va='bottom',fontsize=10,fontweight='bold',color=ink)
fig.suptitle('Cups without a curriculum: 4 of 8 seeds never start drinking',x=0.01,ha='left',fontsize=14,fontweight='bold',color=ink)
fig.text(0.01,0.905,'Loss 0.75, sight 12 + occlusion, cups only from generation 1 (1500 generations; 3000 gives the same four failures). Blue: same setup but the pond-distance and drinking-start stages kept.',fontsize=9,color=ink2)
plt.tight_layout(rect=(0,0,1,0.9))
plt.savefig('docs/forager-lab-nocurriculum-seeds.png',dpi=150,facecolor=bg)
