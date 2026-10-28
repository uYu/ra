#include "ra_ai.cpp"
#include <cstring>
void legacyAppend(std::string&key,int value) {
  uint32_t v=(uint32_t)value;
  for(int j=0;j<4;j++)key.push_back((char)(v>>(8*j)));
}
bool sameKey(const vector<int>&v,bool tiles) {
  std::string fast,slow;
  listKey(fast,v,tiles);
  vector<int>values=v;
  if(tiles){for(int&i:values)i=kind(i)*8+variant(i);std::sort(values.begin(),values.end());}
  legacyAppend(slow,values.size());
  for(int x:values)legacyAppend(slow,x);
  return fast==slow;
}
double legacyRace(const std::array<int,5>&counts,int n,int i,double width) {
  double most=1,least=1;
  for(int j=0;j<n;j++)if(j!=i){double d=(counts[i]-counts[j])/width;most*=1/(1+std::exp(-d));least*=1/(1+std::exp(d));}
  return 5*most-2*least;
}
extern "C" int check_fast_paths() {
  initTiles();
  int checked=0;
  constexpr int sizes[]={0,1,2,7,8,32,180,360,1800};
  for(int id=0;id<180;id++)for(int size:sizes){if(!sameKey(vector<int>(size,id),true))return -1;checked++;}
  uint32_t rng=17;
  auto next=[&](){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;};
  for(int sample=0;sample<512;sample++){
    vector<int>v;
    for(int n=sample%181;n>0;n--)v.push_back(next()%180);
    if(!sameKey(v,true))return -2;
    checked++;
  }
  if(!sameKey({-2147483647,-1,0,1,16,2147483647},false))return -3;
  checked++;
  for(int n=2;n<=5;n++)for(int sample=0;sample<512;sample++){
    std::array<int,5>counts{};
    for(int i=0;i<n;i++)counts[i]=next()%(sample%2?26:181);
    for(int i=0;i<n;i++)for(double width:{1.5,2.1,0.75}){
      double fast=softRace(counts,n,i,width),slow=legacyRace(counts,n,i,width);
      if(std::memcmp(&fast,&slow,sizeof(double)))return -4;
      checked++;
    }
  }
  std::array<std::array<int,5>,8>monumentIds{};
  std::array<std::array<int,5>,5>civilizationIds{};
  std::array<int,8>monumentCounts{};
  std::array<int,5>civilizationCounts{};
  for(int id=0;id<180;id++){
    int v=variant(id);
    if(kind(id)==Monument)monumentIds[v][monumentCounts[v]++]=id;
    if(kind(id)==Civilization)civilizationIds[v][civilizationCounts[v]++]=id;
  }
  Player p;
  p.tiles.reserve(40);
  for(int code=0;code<1679616;code++){
    p.tiles.clear();
    int remainder=code,different=0,two=0,extra=0;
    std::array<int,8>counts{};
    for(int v=0;v<8;v++){
      int count=remainder%6;remainder/=6;counts[v]=count;
      different+=count>0;two+=count==2;if(count>=3)extra+=(count-2)*5;
      for(int j=0;j<count;j++)p.tiles.push_back(monumentIds[v][j]);
    }
    auto fast=inventory(p);
    int score=(different==8?15:different==7?10:different)+extra;
    if(fast.m!=counts||fast.monumentDifferent!=different||fast.monumentTwo!=two||fast.monumentScore!=score)return -5;
    checked++;
  }
  for(int code=0;code<7776;code++){
    p.tiles.clear();
    int remainder=code,different=0;
    std::array<int,5>counts{};
    for(int v=0;v<5;v++){
      int count=remainder%6;remainder/=6;counts[v]=count;different+=count>0;
      for(int j=0;j<count;j++)p.tiles.push_back(civilizationIds[v][j]);
    }
    auto fast=inventory(p);
    if(fast.c!=counts||fast.civ!=different)return -6;
    checked++;
  }
  return checked;
}
