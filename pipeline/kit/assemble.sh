#!/bin/bash
# usage: bash pipeline/kit/assemble.sh : src/*.ts -> kit.ts (rewrites `** 2` to sq(...), asserts no **, ==, != remain)
cd "$(dirname "$0")" && cat src/kit_core.ts src/kit_render.ts src/kit_build.ts src/kit_anat.ts src/kit_beasts.ts src/kit_props.ts src/kit_buildings.ts src/kit_figures.ts src/kit_themes.ts > kit.ts && python3 - <<'PY'
s=open('kit.ts').read()
out=[];i=0
while True:
    j=s.find(') ** 2',i)
    if j<0: out.append(s[i:]);break
    d=0;k=j
    while True:
        if s[k]==')': d+=1
        elif s[k]=='(':
            d-=1
            if d==0: break
        k-=1
    out.append(s[i:k]); out.append('sq'+s[k:j+1]); i=j+6
s=''.join(out).replace("const clamp =","const sq = (x: number): number => x * x;\nconst clamp =",1)
assert '**' not in s and ' == ' not in s.replace('===','') and ' != ' not in s.replace('!==','')
open('kit.ts','w').write(s)
PY
