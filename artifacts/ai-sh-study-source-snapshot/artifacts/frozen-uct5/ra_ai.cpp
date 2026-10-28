// Ra AI WebAssembly core. Protocol and strategy mirror src/game/ai/*.ts.
// All simulations remain inside this module; JS crosses the ABI once per search.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <emscripten/emscripten.h>
using std::vector;
constexpr double INF = std::numeric_limits<double>::infinity();
enum Kind {
  Monument, Pharaoh, God, Gold, Civilization, Nile, Flood, Ra, Earthquake, Funeral, War, Drought
};
enum Phase {
  Turn, Auction, Disaster, GodTurn, Epoch, Over
};
enum Act {
  Draw, Invoke, Bid, Exchange, Finish, Discard, Next
};
struct Tile {
  int kind, variant;
};
std::array<Tile,180> catalog;
void initTiles() {
  static bool done=false;
  if(done) return;
  done=true;
  int id=0;
  auto add=[&](int kind,int n,int variants=1) {
    for(int v=0;v<variants;v++)for(int j=0;j<n;j++)catalog[id++]={kind,v};
  };
  add(Monument,5,8);
  add(Pharaoh,25);
  add(God,8);
  add(Gold,5);
  add(Civilization,5,5);
  add(Nile,25);
  add(Flood,12);
  add(Ra,30);
  add(Earthquake,2);
  add(Funeral,2);
  add(War,4);
  add(Drought,2);
}
bool disaster(int kind) {
  return kind>=Earthquake;
}
struct Action {
  int type=Draw, arg=-1, second=-1, count=0;
};
struct Player {
  vector<int> suns,used,tiles;
  int score=10;
};
struct AuctionState {
  int caller=0,reason=0,index=0,high=0,winner=-1;
  vector<int> order;
  vector<std::array<int,2>> bids;
};
struct State {
  int n=2,epoch=1,phase=Turn,current=0,center=1,ra=0,resume=Turn,next=0,steps=0,last=-1;
  std::array<Player,5> players;
  vector<int> bag,market,pending,discarded;
  bool hasAuction=false;
  AuctionState auction;
};
using Values=std::array<double,5>;
int limit(const State&s) {
  return s.n==2?6:s.n==3?8:s.n==4?9:10;
}
int kind(int id) {
  return catalog[id].kind;
}
int variant(int id) {
  return catalog[id].variant;
}
int sum(const vector<int>&v) {
  int result=0;
  for(int i:v)result+=i;
  return result;
}
int countKind(const vector<int>&v,int k) {
  int result=0;
  for(int id:v)result+=kind(id)==k;
  return result;
}
void eraseId(vector<int>&v,int id) {
  v.erase(std::remove(v.begin(),v.end(),id),v.end());
}
int target(int k) {
  return k==Earthquake?Monument:k==Funeral?Pharaoh:k==War?Civilization:Nile;
}
bool affected(int id,int d) {
  return d==Drought?(kind(id)==Nile||kind(id)==Flood):kind(id)==target(d);
}
int required(const State&s) {
  if(s.pending.empty())return 0;
  int n=0;
  for(int id:s.players[s.current].tiles)n+=affected(id,kind(s.pending[0]));
  return std::min(2,n);
}
struct Inventory {
  std::array<int,8> m{};
  std::array<int,5> c{};
  int ph=0,nile=0,flood=0,gold=0,god=0,civ=0;
};
Inventory inventory(const Player&p) {
  Inventory v;
  for(int id:p.tiles) {
    int k=kind(id),t=variant(id);
    switch(k) {
      case Monument:v.m[t]++;
      break;
      case Civilization:v.c[t]++;
      break;
      case Pharaoh:v.ph++;
      break;
      case Nile:v.nile++;
      break;
      case Flood:v.flood++;
      break;
      case Gold:v.gold++;
      break;
      case God:v.god++;
      break;
    }
  }
  for(int n:v.c)v.civ+=n>0;
  return v;
}
int monuments(const std::array<int,8>&m) {
  int diff=0,extra=0;
  for(int n:m) {
    diff+=n>0;
    if(n>=3)extra+=(n-2)*5;
  }
  return (diff==8?15:diff==7?10:diff)+extra;
}
// Exact scoring and rule transitions, independent of search.
Values epochScores(const State&s) {
  Values values{};
  std::array<Inventory,5> all;
  int phLo=1000,phHi=-1,sunLo=1000,sunHi=-1;
  std::array<int,5>suns{};
  for(int i=0;i<s.n;i++) {
    all[i]=inventory(s.players[i]);
    phLo=std::min(phLo,all[i].ph);
    phHi=std::max(phHi,all[i].ph);
    suns[i]=sum(s.players[i].suns)+sum(s.players[i].used);
    sunLo=std::min(sunLo,suns[i]);
    sunHi=std::max(sunHi,suns[i]);
  }
  for(int i=0;i<s.n;i++) {
    auto&p=all[i];
    values[i]=(phLo==phHi?0:p.ph==phHi?5:p.ph==phLo?-2:0)+(p.flood?p.flood+p.nile:0)+(p.civ==0?-5:p.civ>=3?(p.civ-2)*5:0)+p.gold*3+p.god*2;
    if(s.epoch==3)values[i]+=monuments(p.m)+(sunLo==sunHi?0:suns[i]==sunHi?5:suns[i]==sunLo?-5:0);
  }
  return values;
}
void endEpoch(State&s) {
  auto v=epochScores(s);
  for(int i=0;i<s.n;i++)s.players[i].score=std::max(0,s.players[i].score+(int)v[i]);
  s.phase=s.epoch==3?Over:Epoch;
  s.hasAuction=false;
}
void finishTurn(State&s,int from) {
  for(int j=1;j<=s.n;j++) {
    int i=(from+j)%s.n;
    if(!s.players[i].suns.empty()) {
      s.current=i;
      s.phase=Turn;
      return;
    }
  }
  endEpoch(s);
}
void startAuction(State&s,int reason) {
  auto&a=s.auction;
  a=AuctionState{};
  a.caller=s.current;
  a.reason=reason;
  for(int j=1;j<=s.n;j++) {
    int i=(s.current+j)%s.n;
    if(!s.players[i].suns.empty())a.order.push_back(i);
  }
  s.hasAuction=true;
  s.phase=Auction;
  s.current=a.order[0];
}
void settle(State&s) {
  while(!s.pending.empty()) {
    if(required(s)>0) {
      s.phase=Disaster;
      return;
    }
    s.discarded.push_back(s.pending.front());
    s.pending.erase(s.pending.begin());
  }
  if(s.resume==GodTurn)s.phase=GodTurn;
  else finishTurn(s,s.next);
}
void acquire(State&s,const vector<int>&tiles,int player,int resume,int from) {
  s.current=player;
  for(int id:tiles) {
    if(disaster(kind(id)))s.pending.push_back(id);
    else s.players[player].tiles.push_back(id);
  }
  s.resume=resume;
  s.next=from;
  settle(s);
}
void resolveAuction(State&s) {
  auto a=s.auction;
  s.hasAuction=false;
  if(a.winner<0) {
    if(a.reason==2) {
      s.discarded.insert(s.discarded.end(),s.market.begin(),s.market.end());
      s.market.clear();
    }
    finishTurn(s,a.caller);
    return;
  }
  auto&p=s.players[a.winner];
  eraseId(p.suns,a.high);
  p.used.push_back(s.center);
  s.center=a.high;
  auto tiles=std::move(s.market);
  s.market.clear();
  acquire(s,tiles,a.winner,Turn,a.caller);
}
void apply(State&s,const Action&a) {
  s.steps++;
  auto&p=s.players[s.current];
  switch(a.type) {
    case Draw: {
      int id=s.bag.back();
      s.bag.pop_back();
      s.last=id;
      if(kind(id)==Ra) {
        s.discarded.push_back(id);
        s.ra++;
        if(s.ra>=limit(s))endEpoch(s);
        else startAuction(s,0);
      }
      else {
        s.market.push_back(id);
        finishTurn(s,s.current);
      }
      break;
    }
    case Invoke:startAuction(s,s.market.size()==8?2:1);
    break;
    case Bid: {
      auto&b=s.auction;
      b.bids.push_back({s.current,a.arg});
      if(a.arg>=0) {
        b.high=a.arg;
        b.winner=s.current;
      }
      b.index++;
      if(b.index==(int)b.order.size())resolveAuction(s);
      else s.current=b.order[b.index];
      break;
    }
    case Exchange: {
      int god=-1;
      for(int id:p.tiles)if(kind(id)==God) {
        god=id;
        break;
      }
      eraseId(p.tiles,god);
      s.discarded.push_back(god);
      eraseId(s.market,a.arg);
      acquire(s,{a.arg},s.current,GodTurn,s.current);
      break;
    }
    case Finish:finishTurn(s,s.current);
    break;
    case Discard: {
      vector<int>removed;
      for(int id:p.tiles)if(id==a.arg||(a.count==2&&id==a.second))removed.push_back(id);
      eraseId(p.tiles,a.arg);
      if(a.count==2)eraseId(p.tiles,a.second);
      int d=s.pending.front();
      s.pending.erase(s.pending.begin());
      s.discarded.insert(s.discarded.end(),removed.begin(),removed.end());
      s.discarded.push_back(d);
      settle(s);
      break;
    }
    case Next: {
      s.epoch++;
      s.ra=0;
      s.discarded.insert(s.discarded.end(),s.market.begin(),s.market.end());
      s.market.clear();
      int high=-1;
      for(int i=0;i<s.n;i++) {
        auto&q=s.players[i];
        vector<int>keep;
        for(int id:q.tiles) {
          int k=kind(id);
          if(k==Monument||k==Pharaoh||k==Nile)keep.push_back(id);
          else s.discarded.push_back(id);
        }
        q.tiles=std::move(keep);
        q.suns.insert(q.suns.end(),q.used.begin(),q.used.end());
        std::sort(q.suns.begin(),q.suns.end());
        q.used.clear();
        for(int sun:q.suns)if(sun>high) {
          high=sun;
          s.current=i;
        }
      }
      s.phase=Turn;
      s.last=-1;
      break;
    }
  }
}
bool forced(const State&s) {
  return s.hasAuction&&s.current==s.auction.caller&&s.auction.reason==1&&s.auction.high==0;
}
vector<Action> legal(const State&s) {
  vector<Action>out;
  auto&p=s.players[s.current];
  if(s.phase==Epoch)return {{Next}};
  if(s.phase==Over)return out;
  if(s.phase==Auction) {
    for(int sun:p.suns)if(sun>s.auction.high)out.push_back({Bid,sun});
    if(!forced(s))out.push_back({Bid,-1});
    return out;
  }
  if(s.phase==Disaster) {
    int d=kind(s.pending.front()),n=required(s);
    vector<int>opts;
    for(int id:p.tiles)if(affected(id,d))opts.push_back(id);
    int floods=countKind(opts,Flood);
    auto valid=[&](int a,int b) {
      return d!=Drought||((kind(a)==Flood)+(b>=0&&kind(b)==Flood))==std::min(n,floods);
    };
    for(int i=0;i<(int)opts.size();i++) {
      if(n==1) {
        if(valid(opts[i],-1))out.push_back({Discard,opts[i],-1,1});
      }
      else for(int j=i+1;j<(int)opts.size();j++)if(valid(opts[i],opts[j]))out.push_back({Discard,opts[i],opts[j],2});
    }
    return out;
  }
  if(s.phase==Turn) {
    if(s.market.size()<8&&!s.bag.empty())out.push_back({Draw});
    out.push_back({Invoke});
  }
  if(countKind(p.tiles,God))for(int id:s.market)if(kind(id)!=God)out.push_back({Exchange,id});
  if(s.phase==GodTurn)out.push_back({Finish});
  return out;
}
// Public-information evaluation and auction policy.
double drawsLeft(const State&s) {
  double ra=countKind(s.bag,Ra);
  return std::min((double)s.bag.size(),(limit(s)-s.ra)*(s.bag.size()+1.0)/(ra+1));
}
double softRace(const std::array<int,5>&counts,int n,int i,double width) {
  double most=1,least=1;
  for(int j=0;j<n;j++)if(j!=i) {
    double d=(counts[i]-counts[j])/width;
    most*=1/(1+std::exp(-d));
    least*=1/(1+std::exp(d));
  }
  return 5*most-2*least;
}
Values futureValues(const State&s,const std::array<Inventory,5>*cached=nullptr) {
  Values values{};
  int years=3-s.epoch;
  if(!years)return values;
  std::array<Inventory,5>storage;
  std::array<int,5>ph{};
  vector<int>disks;
  for(int i=0;i<s.n;i++) {
    if(!cached)storage[i]=inventory(s.players[i]);
    ph[i]=(cached?(*cached)[i]:storage[i]).ph;
    disks.insert(disks.end(),s.players[i].suns.begin(),s.players[i].suns.end());
    disks.insert(disks.end(),s.players[i].used.begin(),s.players[i].used.end());
  }
  for(int i=0;i<s.n;i++) {
    auto&p=cached?(*cached)[i]:storage[i];
    double disk=0;
    auto add=[&](int sun) {
      int rank=0;
      for(int d:disks)rank+=d<sun;
      disk+=2.7*((double)rank/std::max(1,(int)disks.size()-1)-0.5);
    };
    for(int sun:s.players[i].suns)add(sun);
    for(int sun:s.players[i].used)add(sun);
    int two=0,diff=0;
    for(int n:p.m) {
      two+=n==2;
      diff+=n>0;
    }
    values[i]=monuments(p.m)+two*(1.35*years/2)+(diff==6?1.1*years/2:0)+years*(softRace(ph,s.n,i,2.1)+p.nile*0.63+disk);
  }
  return values;
}
Values positionValues(const State&s) {
  std::array<Inventory,5>all;
  std::array<int,5>ph{},suns{};
  int lo=1000,hi=-1,sunLo=1000,sunHi=-1,active=0;
  for(int i=0;i<s.n;i++) {
    all[i]=inventory(s.players[i]);
    ph[i]=all[i].ph;
    lo=std::min(lo,ph[i]);
    hi=std::max(hi,ph[i]);
    active+=s.players[i].suns.size();
    suns[i]=sum(s.players[i].suns)+sum(s.players[i].used);
    sunLo=std::min(sunLo,suns[i]);
    sunHi=std::max(sunHi,suns[i]);
  }
  auto future=futureValues(s,&all);
  Values values{};
  double draws=drawsLeft(s),floodLeft=countKind(s.bag,Flood);
  for(int i=0;i<s.n;i++) {
    auto&p=all[i];
    double share=(double)s.players[i].suns.size()/std::max(1,active),access=std::min(1.0,draws*share/9),river=1-std::exp(-floodLeft*draws*share/std::max(1,(int)s.bag.size()));
    int two=0;
    for(int n:p.m)two+=n==2;
    values[i]=(hi==lo?0:ph[i]==hi?5:ph[i]==lo?-2:0)+(p.flood?p.flood+p.nile:p.nile*river)+(p.civ==0?-5:p.civ>=3?(p.civ-2)*5:0)+(p.civ==1?1.0:p.civ==2?2.6:0)*access+p.gold*3+p.god*(2+0.65*access)+0.25*access*softRace(ph,s.n,i,1.5)+future[i];
    if(s.epoch==3)values[i]+=monuments(p.m)+(sunHi==sunLo?0:suns[i]==sunHi?5:suns[i]==sunLo?-5:0)+two*(1.15*access);
  }
  return values;
}
double relative(const Values&v,int n,int player,double rivalry=0.65) {
  double others=0;
  for(int i=0;i<n;i++)if(i!=player)others+=v[i];
  return v[player]-rivalry*others/std::max(1,n-1);
}
double reserveCost(const State&s,int player,int sun,double scale) {
  int active=0,rank=0;
  for(int i=0;i<s.n;i++)for(int d:s.players[i].suns) {
    active++;
    rank+=d<sun;
  }
  double r=(double)rank/std::max(1,active-1),opportunities=drawsLeft(s)/4.2+std::max(0,limit(s)-s.ra-1),availability=std::min(1.0,opportunities/std::max(1,active-1));
  return scale*(3.1+3.4*r)*availability*(s.players[player].suns.size()==1?1.1:1);
}
int tileCode(int id) {
  return kind(id)*8+variant(id);
}
std::string actionKey(const Action&a) {
  if(a.type==Exchange)return "g"+std::to_string(tileCode(a.arg));
  if(a.type==Discard) {
    int x=tileCode(a.arg),y=a.count==2?tileCode(a.second):-1;
    if(y>=0&&y<x)std::swap(x,y);
    return "d"+std::to_string(x)+"/"+std::to_string(y);
  }
  return std::to_string(a.type)+"/"+std::to_string(a.arg);
}
State collectionAfter(const State&s,int player,const vector<int>&lot) {
  State c=s;
  auto&p=c.players[player];
  for(int id:lot)if(!disaster(kind(id)))p.tiles.push_back(id);
  for(int d:lot)if(disaster(kind(d)))for(int n=0;n<2;n++) {
    vector<int>opts;
    bool flood=kind(d)==Drought&&countKind(p.tiles,Flood)>0;
    std::unordered_set<int>seen;
    for(int id:p.tiles)if(affected(id,kind(d))&&(!flood||kind(id)==Flood)&&seen.insert(tileCode(id)).second)opts.push_back(id);
    int best=-1;
    double value=-INF;
    for(int id:opts) {
      auto before=p.tiles;
      eraseId(p.tiles,id);
      double v=relative(positionValues(c),c.n,player);
      p.tiles=std::move(before);
      if(v>value) {
        best=id;
        value=v;
      }
    }
    if(best>=0)eraseId(p.tiles,best);
  }
  return c;
}
struct Model {
  std::array<double,5>cost{1,1,1,1,1};
  double rivalry=0.65;
};
struct Plan {
  std::array<Action,5>actions{};
  int size=0,winner=-1,sun=0;
  Values values{};
};
Plan auctionPlan(const State&s,const Model&model=Model{}) {
  auto&a=s.auction;
  auto base=positionValues(s);
  std::array<std::array<Values,17>,5>outcomes{};
  for(int i=0;i<s.n;i++) {
    if(s.players[i].suns.empty())continue;
    auto won=collectionAfter(s,i,s.market);
    for(int sun:s.players[i].suns) {
      State changed=won;
      eraseId(changed.players[i].suns,sun);
      changed.players[i].used.push_back(s.center);
      changed.center=sun;
      auto v=positionValues(changed);
      v[i]-=reserveCost(s,i,sun,model.cost[i]);
      outcomes[i][sun]=v;
    }
  }
  auto search=[&](auto&&self,int index,int high,int winner)->Plan {
    if(index==(int)a.order.size()) {
      Plan p;
      p.values=winner<0?base:outcomes[winner][high];
      p.winner=winner;
      p.sun=high;
      return p;
    }
    int i=a.order[index];
    bool force=i==a.caller&&a.reason==1&&high==0;
    vector<int>bids;
    if(!force)bids.push_back(-1);
    auto sorted=s.players[i].suns;
    std::sort(sorted.begin(),sorted.end());
    for(int sun:sorted)if(sun>high)bids.push_back(sun);
    Plan best;
    double value=-INF;
    for(int sun:bids) {
      auto child=self(self,index+1,sun<0?high:sun,sun<0?winner:i);
      double v=relative(child.values,s.n,i,model.rivalry);
      if(v>value+1e-8) {
        best=child;
        for(int j=best.size;j>0;j--)best.actions[j]=best.actions[j-1];
        best.actions[0]={Bid,sun};
        best.size++;
        value=v;
      }
    }
    return best;
  };
  return search(search,a.index,a.high,a.winner);
}
Action bestDiscard(const State&s) {
  Action best;
  double value=-INF;
  std::unordered_set<std::string>seen;
  for(auto&a:legal(s)) {
    if(!seen.insert(actionKey(a)).second)continue;
    State next=s;
    eraseId(next.players[s.current].tiles,a.arg);
    if(a.count==2)eraseId(next.players[s.current].tiles,a.second);
    double v=relative(positionValues(next),s.n,s.current);
    if(v>value) {
      best=a;
      value=v;
    }
  }
  return best;
}
struct GodChoice {
  Action action;
  double value;
};
vector<GodChoice>godChoices(const State&s) {
  vector<GodChoice>choices;
  auto before=positionValues(s);
  std::unordered_set<int>seen;
  for(auto&a:legal(s))if(a.type==Exchange&&seen.insert(tileCode(a.arg)).second) {
    State without=s;
    int god=-1;
    for(int id:without.players[s.current].tiles)if(kind(id)==God) {
      god=id;
      break;
    }
    eraseId(without.players[s.current].tiles,god);
    auto after=positionValues(collectionAfter(without,s.current,{a.arg}));
    choices.push_back({a,relative(after,s.n,s.current)-relative(before,s.n,s.current)});
  }
  std::stable_sort(choices.begin(),choices.end(),[](auto&a,auto&b) {
    return a.value>b.value;
  });
  return choices;
}
Action policyAction(const State&s,const Model&model=Model{}) {
  auto actions=legal(s);
  if(actions.size()==1)return actions[0];
  if(s.phase==Epoch)return {Next};
  if(s.phase==Disaster)return bestDiscard(s);
  if(s.phase==Auction)return auctionPlan(s,model).actions[0];
  auto gods=godChoices(s);
  if(!gods.empty()&&gods[0].value>0.7)return gods[0].action;
  if(s.phase==GodTurn)return {Finish};
  bool draw=false;
  for(auto&a:actions)draw|=a.type==Draw;
  if(!draw)return {Invoke};
  State next=s;
  apply(next,{Invoke});
  auto plan=auctionPlan(next,model);
  double gain=relative(plan.values,s.n,s.current,model.rivalry)-relative(positionValues(s),s.n,s.current,model.rivalry);
  return {gain>(drawsLeft(s)<7?0.15:1.0)?Invoke:Draw};
}
vector<Action>candidates(const State&s) {
  if(s.phase==Disaster)return {bestDiscard(s)};
  auto actions=legal(s);
  if(s.phase==Auction)return actions;
  vector<Action>out;
  for(auto&a:actions)if(a.type!=Exchange)out.push_back(a);
  auto gods=godChoices(s);
  for(int i=0;i<std::min(3,(int)gods.size());i++)out.push_back(gods[i].action);
  return out;
}
struct Random {
  uint32_t s;
  explicit Random(uint32_t seed):s(seed) {
  }
  double next() {
    s+=0x6d2b79f5u;
    uint32_t t=s;
    t=(t^(t>>15))*(t|1u);
    t^=t+(t^(t>>7))*(t|61u);
    return (t^(t>>14))/4294967296.0;
  }
};
void shuffle(vector<int>&a,Random&r) {
  for(int i=(int)a.size()-1;i>0;i--) {
    int j=(int)std::floor(r.next()*(i+1));
    std::swap(a[i],a[j]);
  }
}
void appendInt(std::string&key,int value) {
  uint32_t v=(uint32_t)value;
  for(int j=0;j<4;j++)key.push_back((char)(v>>(8*j)));
}
void listKey(std::string&key,const vector<int>&v,bool tiles=false) {
  vector<int>values=v;
  if(tiles) {
    for(int&i:values)i=tileCode(i);
    std::sort(values.begin(),values.end());
  }
  appendInt(key,values.size());
  for(int x:values)appendInt(key,x);
}
std::string observation(const State&s,int observer,bool complete=false) {
  std::string k;
  k.reserve(1200);
  for(int x: {
    s.epoch,s.phase,s.current,s.ra,s.center,(int)s.hasAuction
  })appendInt(k,x);
  if(s.hasAuction)for(int x: {
    s.auction.caller,s.auction.reason,s.auction.index,s.auction.high,s.auction.winner
  })appendInt(k,x);
  listKey(k,s.market,true);
  listKey(k,s.pending,true);
  listKey(k,s.bag,true);
  appendInt(k,s.players[observer].score);
  for(int i=0;i<s.n;i++) {
    listKey(k,s.players[i].suns);
    listKey(k,s.players[i].used);
    listKey(k,s.players[i].tiles,true);
  }
  if(complete) {
    appendInt(k,s.resume);
    appendInt(k,s.next);
    if(s.hasAuction) {
      listKey(k,s.auction.order);
      appendInt(k,s.auction.bids.size());
      for(auto b:s.auction.bids){appendInt(k,b[0]);appendInt(k,b[1]);}
    }
  }
  return k;
}
struct Node;
struct Particle {
  std::string key;
  State state;
  Model model;
  int steps=0,resets=0,weight=1;
  Values deltas{};
  Node*child=nullptr;
};
struct Edge {
  int visits=0;
  Values sums{},squares{},utilities{};
  std::unordered_map<std::string,std::unique_ptr<Node>>outcomes;
  vector<Particle>particles;
};
struct Node {
  int visits=0;
  bool hasPreferred=false;
  std::string preferred;
  vector<std::pair<std::string,std::unique_ptr<Edge>>>edges;
  Edge*get(const std::string&k) {
    for(auto&e:edges)if(e.first==k)return e.second.get();
    return nullptr;
  }
};
struct Candidate {
  Action action;
  double value=0,error=0;
  int visits=0;
};
struct Report {
  vector<Candidate>candidates;
  int samples=0,transitions=0,completed=0,truncated=0,epochAdvances=0,nodes=1,depth=0,scenarios=0,outcomeReuses=0,maxOutcomeBranches=0;
};
struct RootHalving {
  vector<int>active;
  int count,budget,quota,roundUsed=0,used=0;
  bool timed;
  RootHalving(int n,int b,bool t):count(n),budget(b),timed(t) {
    for(int i=0;i<n;i++)active.push_back(i);
    quota=t?1:std::max(1,(int)std::floor((double)b/(std::ceil(std::log2(n))*n)));
  }
  int choose()const {return active[roundUsed%active.size()];}
  void record(const vector<double>&means) {
    used++;
    if(++roundUsed<quota*(int)active.size())return;
    auto better=[&](int a,int b){return means[a]==means[b]?a<b:means[a]>means[b];};
    std::stable_sort(active.begin(),active.end(),better);
    active.resize((active.size()+1)/2);
    roundUsed=0;
    if(timed) {
      if(active.size()==1) {
        active.clear();
        for(int i=0;i<count;i++)active.push_back(i);
        quota=1;
      } else quota*=2;
    } else {
      int rounds=std::max(1,(int)std::ceil(std::log2(active.size())));
      quota=std::max(1,(budget-used)/(rounds*(int)active.size()));
    }
  }
  int best(const vector<double>&means)const {
    int result=timed?0:active[0];
    auto consider=[&](int a){if(means[a]>means[result]||(means[a]==means[result]&&a<result))result=a;};
    if(timed)for(int i=0;i<count;i++)consider(i);
    else for(int i:active)consider(i);
    return result;
  }
};
// Optional, externally supplied value network. No global model state can leak
// from an experimental search into the production default.
struct ValueModel {
  int inputs=91,hidden=0;
  vector<double> weights;
};
vector<double> valueHoldings(const State&s,int player) {
  auto v=inventory(s.players[player]);
  vector<double>x;
  for(int n=0;n<6;n++)x.push_back(std::count(v.m.begin(),v.m.end(),n)/8.0);
  x.push_back(v.ph/10.0);x.push_back(v.nile/10.0);
  for(int n=1;n<=16;n++) {
    auto&p=s.players[player];
    x.push_back(std::find(p.suns.begin(),p.suns.end(),n)!=p.suns.end()||std::find(p.used.begin(),p.used.end(),n)!=p.used.end());
  }
  return x;
}
vector<double> valueFeatures(const State&s,int player) {
  vector<double>x;
  for(int n=2;n<=5;n++)x.push_back(s.n==n);
  x.push_back(s.epoch==1);x.push_back(s.epoch==2);x.push_back(s.center/16.0);
  for(int k=0;k<12;k++)x.push_back(countKind(s.bag,k)/40.0);
  std::array<vector<double>,5> all;
  for(int i=0;i<s.n;i++)all[i]=valueHoldings(s,i);
  for(double v:all[player])x.push_back(v);
  for(int j=0;j<24;j++) {
    double total=0;
    for(int i=0;i<s.n;i++)if(i!=player)total+=all[i][j];
    x.push_back(total/(s.n-1));
  }
  for(int j=0;j<24;j++) {
    double maximum=0;
    for(int i=0;i<s.n;i++)if(i!=player)maximum=std::max(maximum,all[i][j]);
    x.push_back(maximum);
  }
  return x;
}
double valuePrediction(const vector<double>&x,const ValueModel&m) {
  auto&w=m.weights;
  int d=m.inputs,h=m.hidden;
  double y=w[h*(d+1)+h];
  for(int j=0;j<h;j++) {
    double z=w[j*(d+1)+d];
    for(int k=0;k<d;k++)z+=w[j*(d+1)+k]*x[k];
    y+=w[h*(d+1)+j]*std::tanh(z);
  }
  return y*40;
}
Values learnedFuture(const State&s,const ValueModel&m) {
  Values values{};
  if(s.epoch==3||s.phase==Over)return values;
  for(int i=0;i<s.n;i++)values[i]=valuePrediction(valueFeatures(s,i),m);
  return values;
}
struct RolloutModel {
  int inputs=287,hidden=0;
  vector<double>weights;
};
vector<double>policyHoldings(const Player&p) {
  auto v=inventory(p);vector<double>x;
  for(int n=0;n<6;n++)x.push_back(std::count(v.m.begin(),v.m.end(),n)/8.0);
  for(int n=0;n<6;n++)x.push_back(std::count(v.c.begin(),v.c.end(),n)/5.0);
  for(int n:{v.ph,v.nile,v.flood,v.gold,v.god})x.push_back(n/10.0);
  for(int n=1;n<=16;n++)x.push_back(std::find(p.suns.begin(),p.suns.end(),n)!=p.suns.end());
  for(int n=1;n<=16;n++)x.push_back(std::find(p.used.begin(),p.used.end(),n)!=p.used.end());
  return x;
}
vector<double>policyStateFeatures(const State&s) {
  vector<double>x;
  for(int n=2;n<=5;n++)x.push_back(s.n==n);
  for(int n=1;n<=3;n++)x.push_back(s.epoch==n);
  for(int n=0;n<6;n++)x.push_back(s.phase==n);
  x.push_back(s.ra/10.0);x.push_back(s.center/16.0);
  for(int k=0;k<12;k++)x.push_back(countKind(s.bag,k)/40.0);
  for(int k=0;k<12;k++)x.push_back(countKind(s.market,k)/8.0);
  for(int k=0;k<12;k++)x.push_back(countKind(s.pending,k)/2.0);
  auto&a=s.auction;
  x.push_back(s.hasAuction&&a.caller==s.current);
  x.push_back(s.hasAuction?(a.order.size()-a.index)/5.0:0);
  x.push_back(s.hasAuction?a.high/16.0:0);
  x.push_back(s.hasAuction&&a.reason==1&&a.caller==s.current&&a.high==0);
  std::array<vector<double>,5>all;
  for(int i=0;i<s.n;i++)all[i]=policyHoldings(s.players[i]);
  for(double v:all[s.current])x.push_back(v);
  for(int j=0;j<49;j++){double total=0;for(int i=0;i<s.n;i++)if(i!=s.current)total+=all[i][j];x.push_back(total/(s.n-1));}
  for(int j=0;j<49;j++){double largest=0;for(int i=0;i<s.n;i++)if(i!=s.current)largest=std::max(largest,all[i][j]);x.push_back(largest);}
  int next=-1;
  if(s.hasAuction){if(a.index+1<(int)a.order.size())next=a.order[a.index+1];}
  else for(int offset=1;offset<s.n;offset++){int i=(s.current+offset)%s.n;if(!s.players[i].suns.empty()){next=i;break;}}
  for(int j=0;j<49;j++)x.push_back(next<0?0:all[next][j]);
  auto own=inventory(s.players[s.current]);
  for(int n=0;n<6;n++){int count=0;for(int id:s.market)if(kind(id)==Monument&&own.m[variant(id)]==n)count++;x.push_back(count/8.0);}
  for(int n=0;n<6;n++){int count=0;for(int id:s.market)if(kind(id)==Civilization&&own.c[variant(id)]==n)count++;x.push_back(count/5.0);}
  return x;
}
vector<double>policyActionFeatures(const State&s,const Action&a) {
  vector<double>x;
  for(int type=0;type<7;type++)x.push_back(a.type==type);
  x.push_back(a.type==Bid&&a.arg>=0?a.arg/16.0:0);
  x.push_back(a.type==Bid&&a.arg<0);
  vector<int>selected;
  if(a.type==Exchange)selected.push_back(a.arg);
  if(a.type==Discard){selected.push_back(a.arg);if(a.count==2)selected.push_back(a.second);}
  if(a.type==Bid&&a.arg>=0)selected=s.market;
  for(int k=0;k<12;k++)x.push_back(countKind(selected,k)/8.0);
  auto own=inventory(s.players[s.current]);double mon=0,civ=0;
  for(int id:selected){if(kind(id)==Monument)mon+=own.m[variant(id)];if(kind(id)==Civilization)civ+=own.c[variant(id)];}
  x.push_back(mon/40.0);x.push_back(civ/25.0);x.push_back(selected.size()/8.0);
  return x;
}
vector<double>rolloutScores(const State&s,const RolloutModel&m,const vector<Action>&actions) {
  auto base=policyStateFeatures(s);auto&w=m.weights;int d=m.inputs,h=m.hidden;
  vector<double>state(h),values;
  for(int j=0;j<h;j++){double z=w[j*(d+1)+d];for(int k=0;k<263;k++)z+=w[j*(d+1)+k]*base[k];state[j]=z;}
  for(auto&a:actions){auto x=policyActionFeatures(s,a);double y=w[h*(d+1)+h];for(int j=0;j<h;j++){double z=state[j];for(int k=0;k<24;k++)z+=w[j*(d+1)+263+k]*x[k];y+=w[h*(d+1)+j]*std::tanh(z);}values.push_back(y);}
  return values;
}
Action rolloutAction(const State&s,const RolloutModel&m) {
  auto actions=candidates(s);if(actions.size()==1)return actions[0];
  auto scores=rolloutScores(s,m,actions);int best=0;for(int i=1;i<(int)actions.size();i++)if(scores[i]>scores[best])best=i;return actions[best];
}
// Horizon: 0 = this epoch, 1 = game, 2 = this and the next epoch.
// Variant: 0 = UCT, 1 = root Sequential Halving, 2 = DPW.
Report searchAction(const State&s,int budget,int horizon,int variant,double timeMs,const ValueModel*valueModel=nullptr,const RolloutModel*rolloutModel=nullptr) {
  Report report;
  auto rootActions=candidates(s);
  if(rootActions.size()==1) {
    report.candidates.push_back({rootActions[0]});
    return report;
  }
  Node root;
  bool timed=timeMs>0;
  double deadline=timed?emscripten_get_now()+timeMs:INF;
  auto bag=s.bag;
  std::sort(bag.begin(),bag.end());
  Random rng((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u);
  Random chanceRng(((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u)^0x6a09e667u);
  int iterations=timed?1000000:budget*(int)rootActions.size();
  RootHalving halving(rootActions.size(),iterations,timed);
  auto rootMeans=[&]() {
    vector<double>means;
    for(auto&a:rootActions) {
      auto*e=root.get(actionKey(a));
      means.push_back(e&&e->visits?e->utilities[s.current]/e->visits:-INF);
    }
    return means;
  };
  const int targetEpoch=std::min(3,s.epoch+(horizon==2?1:0));
  const int stepLimit=horizon==1?720:(horizon==2?480:240);
  auto finished=[&](const State&next) {
    return next.phase==Over||(horizon!=1&&next.phase==Epoch&&next.epoch>=targetEpoch);
  };
  for(int k=0;k<iterations;k++) {
    if(k>=(int)rootActions.size()&&timed&&emscripten_get_now()>=deadline)break;
    State next=s;
    next.bag=bag;
    for(int i=0;i<s.n;i++)next.players[i].score=100;
    Model model;
    vector<std::pair<Node*,Edge*>>path;
    Node*branch=&root;
    int steps=0;
    while(!finished(next)&&steps<64) {
      auto actions=branch==&root?rootActions:candidates(next);
      vector<std::string>keys;
      for(int i=0;i<(int)actions.size();i++) {
        keys.push_back(actionKey(actions[i]));
      }
      if(!branch->hasPreferred) {
        branch->preferred=actionKey(policyAction(next));
        branch->hasPreferred=true;
      }
      vector<int>allowed;
      if(variant==2&&branch!=&root) {
        for(int i=0;i<(int)actions.size();i++)if(keys[i]==branch->preferred)allowed.push_back(i);
        for(int i=0;i<(int)actions.size();i++)if(keys[i]!=branch->preferred)allowed.push_back(i);
        int width=(int)std::ceil(2*std::sqrt(branch->visits+1.0));
        if((int)allowed.size()>width)allowed.resize(width);
      } else for(int i=0;i<(int)actions.size();i++)allowed.push_back(i);
      vector<int>untried;
      for(int i:allowed)if(!branch->get(keys[i]))untried.push_back(i);
      int choice=-1;
      if(variant==1&&branch==&root)choice=halving.choose();
      for(int i:untried)if(choice<0&&keys[i]==branch->preferred) {
        choice=i;
        break;
      }
      if(choice<0) {
        int offset=(int)std::floor(rng.next()*untried.size());
        if(!untried.empty())choice=untried[offset];
      }
      if(choice<0) {
        double best=-INF;
        for(int i:allowed) {
          auto*e=branch->get(keys[i]);
          double uct=e->utilities[next.current]/e->visits+1.4*std::sqrt(std::log(branch->visits+1.0)/e->visits)+(keys[i]==branch->preferred?0.8/(e->visits+1):0);
          if(uct>best) {
            best=uct;
            choice=i;
          }
        }
      }
      Edge*edge=branch->get(keys[choice]);
      bool expanding=!edge;
      if(!edge) {
        branch->edges.push_back({keys[choice],std::make_unique<Edge>()});
        edge=branch->edges.back().second.get();
      }
      if(branch==&root) {
        Random world((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)(edge->visits+1)*15485863u);
        next.bag=bag;
        shuffle(next.bag,world);
        for(int i=0;i<s.n;i++)model.cost[i]=0.72+world.next()*0.68;
        model.rivalry=0.45+world.next()*0.45;
      }
      path.push_back({branch,edge});
      if(variant==2&&(int)edge->outcomes.size()>=(int)std::ceil(2*std::sqrt(edge->visits+1.0))) {
        int weight=0;
        for(auto&p:edge->particles)weight+=p.weight;
        int ticket=(int)std::floor(chanceRng.next()*weight);
        Particle*particle=nullptr;
        for(auto&p:edge->particles)if((ticket-=p.weight)<0){particle=&p;break;}
        Values scores{};
        for(int i=0;i<s.n;i++)scores[i]=next.players[i].score;
        next=particle->state;
        std::sort(next.bag.begin(),next.bag.end());
        shuffle(next.bag,chanceRng);
        for(int i=0;i<s.n;i++)next.players[i].score=(int)(scores[i]+particle->deltas[i]);
        model=particle->model;
        steps+=particle->steps;
        report.epochAdvances+=particle->resets;
        report.outcomeReuses++;
        branch=particle->child;
        continue;
      }
      int beforeSteps=steps,beforeResets=report.epochAdvances;
      Values beforeScores{};
      for(int i=0;i<s.n;i++)beforeScores[i]=next.players[i].score;
      if(next.phase==Epoch)report.epochAdvances++;
      apply(next,actions[choice]);
      report.transitions++;
      steps++;
      while(!finished(next)&&next.current!=s.current&&steps<240) {
        Plan plan;
        if(rolloutModel){plan.actions[0]=rolloutAction(next,*rolloutModel);plan.size=1;}
        else if(next.phase==Auction)plan=auctionPlan(next,model);
        else {
          plan.actions[0]=policyAction(next,model);
          plan.size=1;
        }
        for(int j=0;j<plan.size;j++) {
          if(finished(next)||next.current==s.current||steps>=240)break;
          if(next.phase==Epoch)report.epochAdvances++;
          apply(next,plan.actions[j]);
          report.transitions++;
          steps++;
        }
      }
      auto observed=observation(next,s.current,variant==2);
      auto it=edge->outcomes.find(observed);
      if(it==edge->outcomes.end()) {
        it=edge->outcomes.emplace(observed,std::make_unique<Node>()).first;
        report.nodes++;
      }
      report.maxOutcomeBranches=std::max(report.maxOutcomeBranches,(int)edge->outcomes.size());
      if(variant==2) {
        Particle particle;
        particle.key=observed;
        particle.state=next;
        particle.model=model;
        particle.steps=steps-beforeSteps;
        particle.resets=report.epochAdvances-beforeResets;
        particle.child=it->second.get();
        for(int i=0;i<s.n;i++)particle.deltas[i]=next.players[i].score-beforeScores[i];
        auto old=std::find_if(edge->particles.begin(),edge->particles.end(),[&](auto&p){return p.key==observed;});
        if(old==edge->particles.end())edge->particles.push_back(std::move(particle));
        else {particle.weight=old->weight+1;*old=std::move(particle);}
      }
      branch=it->second.get();
      if(expanding)break;
    }
    report.depth=std::max(report.depth,(int)path.size());
    while(!finished(next)&&steps<stepLimit) {
      Plan plan;
      if(rolloutModel){plan.actions[0]=rolloutAction(next,*rolloutModel);plan.size=1;}
      else if(next.phase==Auction)plan=auctionPlan(next,model);
      else {
        plan.actions[0]=policyAction(next,model);
        plan.size=1;
      }
      for(int j=0;j<plan.size;j++) {
        if(finished(next)||steps>=stepLimit)break;
        if(next.phase==Epoch)report.epochAdvances++;
        apply(next,plan.actions[j]);
        report.transitions++;
        steps++;
      }
    }
    if(next.phase==Over)report.completed++;
    if(!finished(next))report.truncated++;
    auto residual=(next.phase==Over||next.phase==Epoch)?(valueModel?learnedFuture(next,*valueModel):futureValues(next)):positionValues(next);
    Values scores{},rewards{};
    for(int i=0;i<s.n;i++)scores[i]=residual[i]+next.players[i].score-100;
    for(int i=0;i<s.n;i++)rewards[i]=relative(scores,s.n,i,s.n==2?1:0.72);
    for(auto&item:path) {
      item.first->visits++;
      auto*e=item.second;
      e->visits++;
      for(int i=0;i<s.n;i++) {
        double v=rewards[i];
        e->sums[i]+=v;
        e->squares[i]+=v*v;
        e->utilities[i]+=std::tanh(v/20);
      }
    }
    report.samples++;
    if(variant==1)halving.record(rootMeans());
  }
  std::string selected=variant==1?actionKey(rootActions[halving.best(rootMeans())]):"";
  for(auto&a:rootActions) {
    auto*e=root.get(actionKey(a));
    double value=e->sums[s.current]/e->visits;
    report.candidates.push_back({a,value,std::sqrt(std::max(0.0,e->squares[s.current]/e->visits-value*value)/e->visits),e->visits});
    report.scenarios=std::max(report.scenarios,e->visits);
  }
  std::stable_sort(report.candidates.begin(),report.candidates.end(),[&](auto&a,auto&b) {
    if((actionKey(a.action)==selected)!=(actionKey(b.action)==selected))return actionKey(a.action)==selected;
    return a.visits==b.visits?a.value>b.value:a.visits>b.visits;
  });
  return report;
}
// Versioned numeric ABI, bounded and checked before native indexing.
alignas(8) double input[16384],output[16384];
int cursor=0,inputLength=0,out=0;
bool bad=false;
int read() {
  if(cursor>=inputLength) {
    bad=true;
    return 0;
  }
  double d=input[cursor++];
  if(!std::isfinite(d)||d!=std::floor(d)||d<-2147483647||d>2147483647) {
    bad=true;
    return 0;
  }
  return (int)d;
}
vector<int>readList(int max=180,bool tiles=true) {
  int n=read();
  if(n<0||n>max||cursor+n>inputLength) {
    bad=true;
    return {};
  }
  vector<int>v;
  v.reserve(n);
  for(int i=0;i<n;i++) {
    int x=read();
    if(x<0||(tiles?x>=180:x>16))bad=true;
    v.push_back(x);
  }
  return v;
}
void put(double v) {
  if(out>=16384) {
    bad=true;
    return;
  }
  output[out++]=v;
}
void putList(const vector<int>&v) {
  put(v.size());
  for(int x:v)put(x);
}
State readState() {
  State s;
  if(read()!=1)bad=true;
  s.n=read();
  s.epoch=read();
  s.phase=read();
  s.current=read();
  s.center=read();
  s.ra=read();
  s.resume=read();
  s.next=read();
  s.steps=read();
  s.last=read();
  if(s.n<2||s.n>5||s.epoch<1||s.epoch>3||s.phase<0||s.phase>5||s.current<0||s.current>=s.n||s.center<1||s.center>16||s.ra<0||s.ra>10||(s.resume!=Turn&&s.resume!=GodTurn)||s.next<0||s.next>=s.n||s.steps<0||s.last<-1||s.last>=180) {
    bad=true;
    return s;
  }
  s.bag=readList();
  s.market=readList();
  s.pending=readList();
  s.discarded=readList();
  for(int i=0;i<s.n;i++) {
    s.players[i].score=read();
    s.players[i].suns=readList(16,false);
    s.players[i].used=readList(16,false);
    s.players[i].tiles=readList();
  }
  s.hasAuction=read()!=0;
  if(s.hasAuction) {
    auto&a=s.auction;
    a.caller=read();
    a.reason=read();
    a.index=read();
    a.high=read();
    a.winner=read();
    a.order=readList(5,false);
    int n=read();
    if(n<0||n>5) {
      bad=true;
      return s;
    }
    for(int j=0;j<n;j++)a.bids.push_back({read(),read()});
    if(a.caller<0||a.caller>=s.n||a.reason<0||a.reason>2||a.index<0||a.index>=(int)a.order.size()||a.high<0||a.high>16||a.winner<-1||a.winner>=s.n)bad=true;
    for(int i:a.order)if(i>=s.n)bad=true;
  }
  if(bad)return s;
  if(s.phase==Auction&&!s.hasAuction)bad=true;
  if(s.phase==Disaster&&(s.pending.empty()||!disaster(kind(s.pending[0]))))bad=true;
  return s;
}
void putState(const State&s) {
  put(1);
  for(int x: {
    s.n,s.epoch,s.phase,s.current,s.center,s.ra,s.resume,s.next,s.steps,s.last
  })put(x);
  putList(s.bag);
  putList(s.market);
  putList(s.pending);
  putList(s.discarded);
  for(int i=0;i<s.n;i++) {
    put(s.players[i].score);
    putList(s.players[i].suns);
    putList(s.players[i].used);
    putList(s.players[i].tiles);
  }
  put(s.hasAuction);
  if(s.hasAuction) {
    auto&a=s.auction;
    for(int x: {
      a.caller,a.reason,a.index,a.high,a.winner
    })put(x);
    putList(a.order);
    put(a.bids.size());
    for(auto b:a.bids) {
      put(b[0]);
      put(b[1]);
    }
  }
}
void putAction(const Action&a) {
  put(a.type);
  put(a.arg);
  put(a.second);
  put(a.count);
}
Action readAction() {
  return {read(),read(),read(),read()};
}
bool equalAction(const Action&a,const Action&b) {
  if(a.type!=b.type)return false;
  if(a.type==Bid||a.type==Exchange)return a.arg==b.arg;
  if(a.type==Discard)return a.count==b.count&&(a.count==1?a.arg==b.arg:((a.arg==b.arg&&a.second==b.second)||(a.arg==b.second&&a.second==b.arg)));
  return true;
}
extern "C" {
  int abi_version() {
    return 5;
  }
  double* input_ptr() {
    return input;
  }
  double* output_ptr() {
    return output;
  }
  int run(int op,int length,int samples,int horizon,int variant,double timeMs) {
    initTiles();
    cursor=out=0;
    bad=false;
    inputLength=length;
    if(length<1||length>16384)return -1;
    State s=readState();
    if(bad)return -2;
    ValueModel model;RolloutModel rolloutModel;
    bool hasModel=false,hasRollout=false;
    auto readNetwork=[&](auto&network,int inputs,int maxHidden,bool&enabled) {
      int flag=read();if(flag<0||flag>1||bad)return false;enabled=flag==1;
      if(enabled){
        network.inputs=read();network.hidden=read();
        if(network.inputs!=inputs||network.hidden<1||network.hidden>maxHidden||bad)return false;
        int n=network.hidden*(network.inputs+2)+1;if(cursor+n>length)return false;
        for(int i=0;i<n;i++){double v=input[cursor++];if(!std::isfinite(v)||(inputs==287&&std::abs(v)>1e6))return false;network.weights.push_back(v);}
      }
      return !bad;
    };
    if(op==0||op==7)if(!readNetwork(model,91,48,hasModel))return -6;
    if(op==0||op==8)if(!readNetwork(rolloutModel,287,16,hasRollout))return -6;
    if((op==0||op==7||op==8)&&cursor!=length)return -6;
    if(op==0) {
      if(samples<1||samples>512||s.phase==Over||horizon<0||horizon>2||variant<0||variant>2||!std::isfinite(timeMs)||timeMs<0||timeMs>1000)return -3;
      auto r=searchAction(s,samples,horizon,variant,timeMs,hasModel?&model:nullptr,hasRollout?&rolloutModel:nullptr);
      for(int x: {
        r.samples,r.transitions,r.completed,r.truncated,r.epochAdvances,r.nodes,r.depth,r.scenarios,r.outcomeReuses,r.maxOutcomeBranches,(int)r.candidates.size()
      })put(x);
      for(auto&c:r.candidates) {
        putAction(c.action);
        put(c.value);
        put(c.error);
        put(c.visits);
      }
    }
    else if(op==1) {
      auto a=readAction();
      bool valid=false;
      for(auto&b:legal(s))valid|=equalAction(a,b);
      if(!valid||bad)return -4;
      apply(s,a);
      putState(s);
    }
    else if(op==2) {
      auto p=positionValues(s),f=futureValues(s),e=epochScores(s);
      for(int i=0;i<s.n;i++)put(p[i]);
      for(int i=0;i<s.n;i++)put(f[i]);
      for(int i=0;i<s.n;i++)put(e[i]);
    }
    else if(op==3) {
      if(s.phase==Over)return -3;
      putAction(policyAction(s));
    }
    else if(op==4||op==5) {
      auto actions=op==4?legal(s):candidates(s);
      put(actions.size());
      for(auto&a:actions)putAction(a);
    }
    else if(op==6) {
      if(s.phase!=Auction)return -3;
      auto p=auctionPlan(s);
      put(p.size);
      for(int j=0;j<p.size;j++)putAction(p.actions[j]);
      for(int i=0;i<s.n;i++)put(p.values[i]);
      put(p.winner);
      put(p.sun);
    }
    else if(op==7) {
      if(!hasModel)return -6;
      auto values=learnedFuture(s,model);
      for(int i=0;i<s.n;i++) {
        auto features=valueFeatures(s,i);
        put(features.size());for(double x:features)put(x);
        put(values[i]);
      }
    }
    else if(op==8) {
      if(!hasRollout||s.phase==Over)return -6;
      auto base=policyStateFeatures(s);put(base.size());for(double x:base)put(x);
      auto actions=candidates(s);auto scores=rolloutScores(s,rolloutModel,actions);put(actions.size());
      for(int i=0;i<(int)actions.size();i++){putAction(actions[i]);auto features=policyActionFeatures(s,actions[i]);put(features.size());for(double x:features)put(x);put(scores[i]);}
    }
    else return -3;
    return bad?-5:out;
  }
}
