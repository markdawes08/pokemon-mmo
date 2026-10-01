"""Reproducibly build the private source capture continuation."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('battle_build',ROOT/'tools/battle-spike/build.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
EXPORTS=['capture_'+name for name in ('abi_version','input_word_count','state_word_count','input_begin','input_set','start','advance','name_begin','name_set','decide','get','mon_get','state_get','import_begin','import_set','import_commit','constant','capacity')]


def main():
    lock=base.read(ROOT/'tools/battle-spike/toolchain-lock.json')
    directory=ROOT/'.tools'/lock['directory'];compiler=directory/lock['executable']
    receipt=base.read(directory/'.pokewaterblue-toolchain.json')
    if directory.resolve()!=directory or receipt['archiveSha256']!=lock['sha256'] or base.digest(compiler)!=receipt['executableSha256']:
        raise RuntimeError('Compiler differs from pinned receipt')
    version=subprocess.run([str(compiler),'version'],cwd=ROOT,text=True,capture_output=True,check=True).stdout.strip()
    if version!=lock['version']:raise RuntimeError('Wrong compiler version')
    outputs=[]
    for name in ('primary','rebuild'):
        work=ROOT/'.local/battle-capture'/name;work.mkdir(parents=True,exist_ok=True)
        if work.resolve()!=work or any(p.is_symlink() or p.is_junction() for p in work.rglob('*')):
            raise RuntimeError('Redirected private output')
        extracted=work/'extracted'
        subprocess.run([sys.executable,str(Path(__file__).with_name('extract.py')),'--out',str(extracted)],cwd=ROOT,check=True)
        wasm=work/'capture.wasm'
        args=['cc','-target','wasm32-freestanding','-std=c11','-O2','-g0','-nostdlib','-fno-strict-aliasing',
              '-Werror=implicit-function-declaration','-Werror=incompatible-pointer-types','-Wl,--no-entry',
              '-Wl,-z,stack-size=65536','-Wl,--initial-memory=262144','-Wl,--max-memory=262144']
        args+=['-Wl,--export='+value for value in EXPORTS]
        args+=['-I',str(extracted),str(extracted/'capture.c'),'-o',str(wasm)]
        run=subprocess.run([str(compiler),*args],cwd=ROOT,text=True,capture_output=True)
        (work/'compiler-diagnostics.txt').write_text(run.stdout+run.stderr,encoding='utf-8')
        if run.returncode:print(run.stdout+run.stderr,file=sys.stderr);raise RuntimeError('Capture compilation failed')
        outputs.append({'wasmSha256':base.digest(wasm),'extraction':base.read(extracted/'extraction-manifest.json')})
    if outputs[0]!=outputs[1]:raise RuntimeError('Independent capture builds differ')
    report={'schemaVersion':1,'checkedAt':datetime.now(timezone.utc).isoformat(),'status':'passed',
            'profile':'firered-route1-capture-v1','scope':'private source continuation; no owned or live effects',
            'toolchain':{**lock,'executableSha256':receipt['executableSha256']},'target':'wasm32-freestanding',
            'abiVersion':1,'checkpointVersion':1,'checkpointWords':160,'inputWords':80,'exports':EXPORTS,
            'fixedLinearMemoryBytes':262144,'importsExpected':[],'independentBuilds':2,
            'wasm':'.local/battle-capture/primary/capture.wasm','wasmBytes':(ROOT/'.local/battle-capture/primary/capture.wasm').stat().st_size,
            'wasmSha256':outputs[0]['wasmSha256'],'codecSha256':base.digest(ROOT/'.local/battle-capture/primary/extracted/codec.json'),'extraction':outputs[0]['extraction']}
    (ROOT/'reports/battle-capture-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({k:report[k] for k in ('status','wasmBytes','wasmSha256','independentBuilds')}))


if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.CalledProcessError) as error:raise SystemExit(str(error)) from error
