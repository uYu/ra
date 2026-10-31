// First encountered auction only: never recurse into another sampled auction.
double turnAuctionMetrics[8]{};
double turnAuctionPlan[8]{};
extern "C" double* turn_auction_metrics(){return turnAuctionMetrics;}
extern "C" double* turn_auction_plan(){return turnAuctionPlan;}
Plan firstAuctionPlan(const State&s,int horizon,int target) {
  Plan plan;
  double started=emscripten_get_now();
  // auctionSampleSearch sorts and independently reshuffles the remaining bag.
  // Bidders therefore cannot condition on the outer rollout's hidden draw order.
  auto report=auctionSampleSearch(s,8,horizon,0,&plan,target);
  double elapsed=emscripten_get_now()-started;
  turnAuctionMetrics[0]++;
  turnAuctionMetrics[1]+=report.scenarios;
  turnAuctionMetrics[2]+=report.samples;
  turnAuctionMetrics[3]+=report.transitions;
  turnAuctionMetrics[4]+=report.truncated;
  turnAuctionMetrics[5]+=elapsed;
  turnAuctionMetrics[6]=std::max(turnAuctionMetrics[6],elapsed);
  return plan;
}
