// Isolated study only: exhaustive current auction + sampled policy continuations.
int auctionStudyMode=0;
double auctionStudyMetrics[8]{};
double auctionStudyLeaves[1024]{};
extern "C" void configure_auction_study(int mode){auctionStudyMode=mode;}
extern "C" double* auction_study_metrics(){return auctionStudyMetrics;}
extern "C" double* auction_study_leaves(){return auctionStudyLeaves;}
struct AuctionStudyNode {
  int actor=-1,leaf=-1;
  vector<Action>actions;
  vector<int>children;
};
struct AuctionStudyLeaf {
  State state;
  int winner=-1,sun=0;
  Values sums{},squares{},utilities{};
};
Report auctionSampleSearch(const State&s,int budget,int horizon,double timeMs) {
  Report report;
  double started=emscripten_get_now(),deadline=timeMs>0?started+timeMs:INF;
  vector<AuctionStudyNode>tree;
  vector<AuctionStudyLeaf>leaves;
  int initialSteps=s.auction.order.size()-s.auction.index;
  auto build=[&](auto&&self,const State&state,int winner,int high)->int {
    int id=tree.size();tree.push_back({});
    if(state.phase!=Auction) {
      int index=-1;
      for(int j=0;j<(int)leaves.size();j++)if(leaves[j].winner==winner&&leaves[j].sun==high){index=j;break;}
      if(index<0){index=leaves.size();AuctionStudyLeaf leaf;leaf.state=state;leaf.winner=winner;leaf.sun=high;leaves.push_back(std::move(leaf));}
      tree[id].leaf=index;return id;
    }
    tree[id].actor=state.current;
    auto actions=legal(state);
    tree[id].actions=actions;
    for(const auto&a:actions) {
      State next=state;
      apply(next,a);report.transitions++;
      int w=a.arg<0?winner:state.current,h=a.arg<0?high:a.arg;
      int child=self(self,next,w,h);
      tree[id].children.push_back(child);
    }
    return id;
  };
  State initial=s;initial.recordDiscards=false;initial.discarded.clear();
  build(build,initial,s.auction.winner,s.auction.high);
  report.nodes=tree.size();report.depth=initialSteps;
  auto bag=s.bag;std::sort(bag.begin(),bag.end());
  const int targetEpoch=std::min(3,s.epoch+(horizon==2?1:0));
  const int stepLimit=horizon==1?720:(horizon==2?480:240);
  auto finished=[&](const State&state){return state.phase==Over||(horizon!=1&&state.phase==Epoch&&state.epoch>=targetEpoch);};
  int rounds=0;
  while(timeMs>0?(rounds==0||emscripten_get_now()<deadline):rounds<budget) {
    Model model;auto worldBag=bag;
    Random random((uint32_t)(s.steps+1)*7919u^(uint32_t)(s.current+1)*104729u^(uint32_t)(rounds+1)*15485863u);
    shuffle(worldBag,random);
    for(int i=0;i<s.n;i++)model.cost[i]=.72+random.next()*.68;
    model.rivalry=.45+random.next()*.45;
    // Complete one COMMON scenario for every distinct legal outcome. No bids
    // are chosen with knowledge of that scenario; solve only after averaging.
    for(auto&leaf:leaves) {
      State next=leaf.state;next.bag=worldBag;
      int steps=initialSteps;
      while(!finished(next)&&steps<stepLimit) {
        Plan plan;
        if(next.phase==Auction)plan=auctionPlan(next,model);
        else {plan.actions[0]=policyAction(next,model);plan.size=1;}
        for(int j=0;j<plan.size;j++) {
          if(finished(next)||steps>=stepLimit)break;
          if(next.phase==Epoch)report.epochAdvances++;
          apply(next,plan.actions[j]);steps++;report.transitions++;
        }
      }
      if(next.phase==Over)report.completed++;
      if(!finished(next))report.truncated++;
      auto residual=(next.phase==Over||next.phase==Epoch)?futureValues(next):positionValues(next);
      Values scores{};
      for(int i=0;i<s.n;i++)scores[i]=residual[i]+next.players[i].score-100;
      for(int i=0;i<s.n;i++) {
        double value=relative(scores,s.n,i,s.n==2?1:.72);
        leaf.sums[i]+=value;leaf.squares[i]+=value*value;leaf.utilities[i]+=std::tanh(value/20);
      }
      report.samples++;
    }
    rounds++;
  }
  auto solve=[&](auto&&self,int id)->int {
    const auto&node=tree[id];if(node.leaf>=0)return node.leaf;
    int best=-1;double value=-INF;
    for(int child:node.children) {
      int leaf=self(self,child);double v=leaves[leaf].utilities[node.actor]/rounds;
      if(best<0||v>value+1e-12){best=leaf;value=v;}
    }
    return best;
  };
  const auto&root=tree[0];int best=0;double bestUtility=-INF;
  for(int j=0;j<(int)root.actions.size();j++) {
    int outcome=solve(solve,root.children[j]);auto&leaf=leaves[outcome];
    double value=leaf.sums[s.current]/rounds,utility=leaf.utilities[s.current]/rounds;
    report.candidates.push_back({root.actions[j],value,std::sqrt(std::max(0.,leaf.squares[s.current]/rounds-value*value)/rounds),rounds});
    if(j==0||utility>bestUtility+1e-12){best=j;bestUtility=utility;}
  }
  // Only the recommended action moves; preserve legal-order tie breaking.
  std::rotate(report.candidates.begin(),report.candidates.begin()+best,report.candidates.begin()+best+1);
  report.scenarios=rounds;report.outcomeReuses=tree.size()-leaves.size();report.maxOutcomeBranches=leaves.size();
  auctionStudyMetrics[0]=1;auctionStudyMetrics[1]=rounds;auctionStudyMetrics[2]=leaves.size();auctionStudyMetrics[3]=tree.size();auctionStudyMetrics[4]=emscripten_get_now()-started;
  int offset=0;auctionStudyLeaves[offset++]=leaves.size();auctionStudyLeaves[offset++]=rounds;
  for(auto&leaf:leaves){auctionStudyLeaves[offset++]=leaf.winner;auctionStudyLeaves[offset++]=leaf.sun;for(int i=0;i<s.n;i++){auctionStudyLeaves[offset++]=leaf.sums[i]/rounds;auctionStudyLeaves[offset++]=leaf.utilities[i]/rounds;}}
  return report;
}
