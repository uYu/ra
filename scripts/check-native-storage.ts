import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWasmAi } from "../src/game/ai/wasm.ts";

const output = resolve(
  process.argv[2] ?? "artifacts/ai-perf-cache-storage-check",
);
await mkdir(output, { recursive: true });
const build = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
const sha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
assert.equal(sha(await readFile(build.source)), build.sourceSha256);
await copyFile(build.source, join(output, "ra_ai.cpp"));
const harness = `#include "ra_ai.cpp"
#include <cstring>
bool sameInventory(const Inventory&a,const Inventory&b) {
  return a.m==b.m&&a.c==b.c&&a.ph==b.ph&&a.nile==b.nile&&a.flood==b.flood&&a.gold==b.gold&&a.god==b.god&&a.civ==b.civ&&a.monumentDifferent==b.monumentDifferent&&a.monumentTwo==b.monumentTwo&&a.monumentScore==b.monumentScore;
}
extern "C" int check_storage() {
  initTiles();
  uint32_t rng=72193;
  auto next=[&](){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;};
  InlineVector<int,4,true>a;
  vector<int>b;
  int checked=0;
  auto matches=[&](const auto&v){return v.size()==b.size()&&std::equal(v.begin(),v.end(),b.begin());};
  for(int step=0;step<20000;step++) {
    int value=next()%180;
    switch(next()%15) {
      case 0:a.push_back(value);b.push_back(value);break;
      case 1:if(!b.empty()){a.pop_back();b.pop_back();}break;
      case 2:if(!b.empty()){size_t i=next()%b.size(),j=i+next()%(b.size()-i+1);a.erase(a.begin()+i,a.begin()+j);b.erase(b.begin()+i,b.begin()+j);}break;
      case 3:{size_t i=next()%(b.size()+1);vector<int>v(next()%9,value);a.insert(a.begin()+i,v.begin(),v.end());b.insert(b.begin()+i,v.begin(),v.end());break;}
      case 4:{size_t n=next()%81;a.resize(n);b.resize(n);break;}
      case 5:a.reserve(next()%200);break;
      case 6:{auto c=a;if(!matches(c))return -1;a=c;break;}
      case 7:{auto c=std::move(a);if(!matches(c)||!a.empty())return -2;a.push_back(17);a=std::move(c);break;}
      case 8:a.clear();b.clear();break;
      case 9:std::sort(a.begin(),a.end());std::sort(b.begin(),b.end());break;
      case 10:std::reverse(a.begin(),a.end());std::reverse(b.begin(),b.end());break;
      case 11:if(!b.empty()){size_t i=next()%b.size();a[i]=value;b[i]=value;}break;
      case 12:{vector<int>v(next()%97,value);a=v;b=v;break;}
      case 13:a={1,2,3};b={1,2,3};break;
      case 14:eraseId(a,value);eraseId(b,value);break;
    }
    if(!matches(a))return -3;
    checked++;
  }
  Player p;
  State s;
  for(int step=0;step<10000;step++) {
    int id=next()%180;
    switch(next()%9) {
      case 0:p.tiles.push_back(id);s.bag.push_back(id);break;
      case 1:eraseId(p.tiles,id);eraseId(s.bag,id);break;
      case 2:if(!p.tiles.empty())p.tiles.pop_back();if(!s.bag.empty())s.bag.pop_back();break;
      case 3:{Player q=p;State t=s;p=q;s=t;break;}
      case 4:{Player q=p;State t=s;p=std::move(q);s=std::move(t);break;}
      case 5:{vector<int>v(next()%181,id);p.tiles=v;s.bag=v;break;}
      case 6:if(!p.tiles.empty())p.tiles[next()%p.tiles.size()]=id;if(!s.bag.empty())s.bag[next()%s.bag.size()]=id;break;
      case 7:std::reverse(p.tiles.begin(),p.tiles.end());std::sort(s.bag.begin(),s.bag.end());break;
      case 8:p.tiles.clear();s.bag.clear();break;
    }
    Player fresh=p;fresh.inventoryRevision=UINT64_MAX;
    auto expected=inventory(fresh);
    if(!sameInventory(inventory(p),expected)||!sameInventory(inventory(p),expected))return -4;
    const State&cs=s;
    for(int k=0;k<12;k++)if(bagCount(s,k)!=countKind(cs.bag,k)||bagCount(s,k)!=countKind(cs.bag,k))return -5;
    checked++;
  }
  // Inline-to-heap transitions, and retained heap capacity after shrinking.
  for(int n:{0,1,4,5,8,9,32,33,180,181,360,1800}) {
    vector<int>v(n,42);
    p.tiles=v;s.bag=v;
    if(inventory(p).ph!=n||bagCount(s,Pharaoh)!=n)return -6;
    auto q=p;auto t=s;
    if(inventory(q).ph!=n||bagCount(t,Pharaoh)!=n)return -7;
    p.tiles={};s.bag={};
    if(inventory(p).ph||bagCount(s,Pharaoh))return -8;
    checked++;
  }
  for(int n:{1,4,5,8,9,32,33,180,181,360,1800,4096}) {
    InlineVector<int,4,true>values;
    for(int i=0;i<n;i++)values.push_back(i);
    // Capture an aliased element before reserve/reallocation inside push_back.
    values.push_back(values.front());
    if(values.size()!=(size_t)n+1||values.back()!=0)return -9;
    checked++;
  }
  return checked;
}
`;
await writeFile(join(output, "check.cpp"), harness);
const flags = build.flags.filter(
  (f: string) => !f.startsWith("-sEXPORTED_FUNCTIONS="),
);
flags.push(
  '-sEXPORTED_FUNCTIONS=["_abi_version","_input_ptr","_output_ptr","_run","_check_storage"]',
  "-fsanitize=undefined",
  "-fsanitize-trap=undefined",
);
const binary = join(output, "check.wasm");
const compilation = spawnSync(
  process.env.EMXX ?? "em++",
  [join(output, "check.cpp"), ...flags, "-o", binary],
  { env: process.env, stdio: "inherit" },
);
assert.equal(compilation.status, 0, "Storage diagnostic compilation failed");
const ai = await createWasmAi(await readFile(binary));
const checks = (
  ai as unknown as { native: { check_storage(): number } }
).native.check_storage();
assert.equal(checks, 30024, `Storage or cache mismatch: ${checks}`);
assert.equal(sha(await readFile(build.source)), build.sourceSha256);
assert.equal(sha(await readFile(build.target)), build.wasmSha256);
const result = {
  status: "passed",
  checkedAt: new Date().toISOString(),
  checks,
  sanitizer: "undefined behavior traps",
  sourceSha256: build.sourceSha256,
  productionWasmSha256: build.wasmSha256,
  description:
    "20,000 vector differential operations, 10,000 cache invalidation/ownership cases, 12 inline/heap boundary sizes and 12 aliased push cases",
};
await writeFile(
  join(output, "summary.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
