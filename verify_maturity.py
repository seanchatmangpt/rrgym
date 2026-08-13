#!/usr/bin/env python3
import argparse, hashlib, json, sys, tomllib
from pathlib import Path
PLANES=("semantics","evaluation","runtime","evidence","operations")
LEVELS=("M0 Seed","M1 Modeled","M2 Admitted","M3 Runnable","M4 Receipted","M5 Replayable","M6 Enterprise")
def digest(v): return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":")).encode()).hexdigest()
def load(path="gym.toml"):
    with open(path,"rb") as h: return tomllib.load(h)
def validate(m):
    e=[]; lv=m.get("maturity",{}).get("planes",{})
    if m.get("contract_version")!="1": e.append("contract_version must be 1")
    if m.get("gym",{}).get("mode")!="offline_simulation": e.append("gym.mode must be offline_simulation")
    if m.get("exercise",{}).get("kind")!="offline_simulation": e.append("exercise.kind must be offline_simulation")
    for p in PLANES:
        if not isinstance(lv.get(p),int) or not 0<=lv[p]<=6: e.append(f"invalid plane: {p}")
    return e,lv
def check(m):
    e,lv=validate(m)
    if e: print(json.dumps({"standing":"BLOCKED","errors":e},indent=2)); return 1
    floor=min(lv[p] for p in PLANES); print(json.dumps({"standing":"PARTIAL_ALIVE","overall":LEVELS[floor],"planes":{p:LEVELS[lv[p]] for p in PLANES}},indent=2,sort_keys=True)); return 0
def evaluate(m,out):
    e,lv=validate(m)
    if e: return check(m)
    s={"gym":m["gym"]["name"],"exercise":m["exercise"]["id"],"mode":m["gym"]["mode"]}
    r={"schema":"gym-receipt/v1","standing":"PARTIAL_ALIVE","subject":s,"observed":["gym.toml"],"admitted":[s],"executed":["offline maturity evaluation"],"changed":[],"verified":["manifest shape","five-plane floor","deterministic receipt"],"inferred":[],"refused":[],"blocked":[],"unsupported":[],"overall_level":min(lv[p] for p in PLANES),"manifest_digest":digest(m),"subject_digest":digest(s)}
    r["receipt_digest"]=digest(r); text=json.dumps(r,indent=2,sort_keys=True)+"\n"
    if out: Path(out).write_text(text)
    print(text,end=""); return 0
def replay(path):
    r=json.loads(Path(path).read_text()); c=r.pop("receipt_digest",None); a=digest(r); ok=c==a
    print(json.dumps({"replay":"PASS" if ok else "FAIL","claimed":c,"actual":a},indent=2)); return 0 if ok else 1
def main():
    p=argparse.ArgumentParser(); p.add_argument("command",choices=("check","evaluate","replay")); p.add_argument("target",nargs="?",default="gym.toml"); p.add_argument("--out"); a=p.parse_args()
    return replay(a.target) if a.command=="replay" else (check(load(a.target)) if a.command=="check" else evaluate(load(a.target),a.out))
if __name__=="__main__": sys.exit(main())
