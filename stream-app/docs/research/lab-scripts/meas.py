import sys
d=open(sys.argv[1],'rb').read(); W,H=320,240
Y=d[:W*H]; U=d[W*H:W*H+W*H//4]; V=d[W*H+W*H//4:W*H*3//2]
for i in [0,1,3]:
    x=(i%4)*80+40; yy=(i//4)*120+60
    print(i,(Y[yy*W+x],U[(yy//2)*(W//2)+x//2],V[(yy//2)*(W//2)+x//2]),end='  ')
print()
