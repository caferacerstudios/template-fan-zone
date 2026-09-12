import {MIRROR_MARKETS} from "./eventspy-mirror-schema.mjs";
export const MARKETPLACE_IDS=MIRROR_MARKETS;

export function currentProviderQuotes(history) {
  const quotes=MIRROR_MARKETS.map((provider,canonicalIndex)=>{
    const field=`${provider}Cents`;
    for(let index=history.length-1;index>=0;index--){
      const priceCents=history[index]?.[field];
      if(Number.isSafeInteger(priceCents)&&priceCents>0)return{provider,priceCents,observedAt:history[index].observedAt,canonicalIndex};
    }
    return{provider,priceCents:null,observedAt:null,canonicalIndex};
  });
  quotes.sort((left,right)=>{
    if(left.priceCents===null)return right.priceCents===null?left.canonicalIndex-right.canonicalIndex:1;
    if(right.priceCents===null)return-1;
    return left.priceCents-right.priceCents||left.canonicalIndex-right.canonicalIndex;
  });
  const lowest=quotes.find(quote=>quote.priceCents!==null)?.priceCents??null;
  const lowestCount=quotes.filter(quote=>quote.priceCents===lowest&&lowest!==null).length;
  return quotes.map((quote,index)=>({...quote,rank:index+1,isLowest:quote.priceCents===lowest&&lowest!==null,isTiedLowest:quote.priceCents===lowest&&lowestCount>1}));
}

export function quoteAtSevenDayLow(history,quote,now=Date.now()) {
  if(!quote||quote.priceCents===null||!quote.observedAt)return false;
  const cutoff=now-7*864e5,field=`${quote.provider}Cents`,observedAt=Date.parse(quote.observedAt);
  if(!Number.isFinite(observedAt)||observedAt<cutoff||observedAt>now)return false;
  const prices=history.filter(point=>{const timestamp=Date.parse(point?.observedAt);return Number.isFinite(timestamp)&&timestamp>=cutoff&&timestamp<=now}).map(point=>point?.[field]).filter(price=>Number.isSafeInteger(price)&&price>0);
  return prices.length>0&&quote.priceCents===Math.min(...prices);
}

export function relativeObservationAge(observedAt,now=Date.now()) {
  const elapsed=now-Date.parse(observedAt);
  if(!Number.isFinite(elapsed))return null;
  const future=elapsed<0,absolute=Math.abs(elapsed),units=absolute<3600e3?["minute",60e3]:absolute<864e5?["hour",3600e3]:["day",864e5];
  const value=Math.max(0,Math.floor(absolute/units[1]))*(future?1:-1);
  return new Intl.RelativeTimeFormat("en-US",{numeric:"auto"}).format(value,units[0]);
}
