import {placeChartLabels} from "./chart-label-layout";
import type {TextElementIR} from "../../core/model";
import type { ElementIR, GroupElementIR, SolidPaintIR } from "../../core/model";
import { DRAWING as A } from "./catalog";
import { child, kids, path, number, fill, hasFill, color, themeFont } from "./appearance";
import { C, cc, ck, value, readChartGroups, formatted, type ChartSeries, type ChartGroup } from "./chart-data";
import { type GraphicContext, solid, label } from "./graphic-context";
import { drawingText } from "./graphic-text";
import { graphicPath } from "./graphic-path";

const supported=new Set(["barChart","lineChart","areaChart","pieChart","doughnutChart","scatterChart","bubbleChart","radarChart"]);
const black=solid(.12,.12,.12),gridPaint=solid(.8,.8,.8);
export async function readChart(space:Element,ctx:GraphicContext):Promise<GroupElementIR>{
  const chart=cc(space,"chart"),plot=cc(chart,"plotArea");
  if(!chart||!plot)throw new Error("invalid-file");
  const root:GroupElementIR={...ctx.base("Chart",ctx.width,ctx.height),kind:"chart",children:[]};
  const groups=readChartGroups(plot,ctx.warn),series=groups.flatMap(g=>g.series);
  ctx.warn("pptx-chart-layout");
  if(cc(space,"externalData"))ctx.warn("pptx-chart-cache");
  const font=themeFont("+mn-lt",ctx.appearance),size=Math.max(8,Math.min(18,12*ctx.scaleY));
  const warnPaint=()=>ctx.warn("pptx-chart-style");
  const background=fill(cc(space,"spPr"),ctx.appearance,warnPaint);
  if(background)root.children.push({...ctx.base("Chart background",ctx.width,ctx.height),kind:"rectangle",fill:background});
  const chartText=cc(space,"txPr"),defaultRun=path(chartText,"p","pPr","defRPr");
  const textSize=number(defaultRun,"sz",size*75)/100*96/72;
  const labelPaint=fill(defaultRun,ctx.appearance,warnPaint)??black;
  const latin=child(defaultRun,"latin")?.getAttribute("typeface");
  const family=latin?themeFont(latin,ctx.appearance):font;
  const dataLabels:TextElementIR[]=[],labelAnchors=new Map<TextElementIR,{x:number;y:number}>();
  const addLabel=(text:string,x:number,y:number,w:number,h:number,align:"LEFT"|"CENTER"|"RIGHT"="LEFT",fontSize=textSize,paint=labelPaint)=>{
    const node=label(ctx,text,x,y,w,h,fontSize,paint,family,align);root.children.push(node);return node;
  };
  const palette=(index:number):SolidPaintIR=>{
    const node=space.ownerDocument.createElementNS(A,"a:schemeClr");node.setAttribute("val",`accent${index%6+1}`);
    return color(node,ctx.appearance,warnPaint)??[solid(.27,.45,.77),solid(.93,.49,.19),solid(.65,.65,.65),solid(1,.75,0),solid(.36,.61,.84),solid(.44,.68,.28)][index%6]!;
  };
  const paintFor=(s:ChartSeries,index:number,point?:number)=>{
    let paint=fill(cc(s.source,"spPr"),ctx.appearance,warnPaint)??palette(index);
    if(child(cc(s.source,"spPr"),"noFill"))paint=solid(0,0,0,0);
    if(point!==undefined){const dpt=ck(s.source).find(e=>e.localName==="dPt"&&number(cc(e,"idx"),"val",-1)===point);if(dpt&&hasFill(cc(dpt,"spPr")))paint=fill(cc(dpt,"spPr"),ctx.appearance,warnPaint)??solid(0,0,0,0);}
    return paint;
  };
  const shapePath=(name:string,data:string,paint?:SolidPaintIR,stroke?:SolidPaintIR,width=1)=>{
    if(data.length>500000)throw new Error("security-limit");
    const e:ElementIR={...ctx.base(name,ctx.width,ctx.height),kind:"path",...graphicPath(data),windingRule:"NONZERO",...(paint?{fill:paint}:{}),...(stroke?{stroke:{paint:stroke,width}}:{})};root.children.push(e);return e;
  };
  const line=(name:string,x1:number,y1:number,x2:number,y2:number,paint=black,width=1)=>shapePath(name,`M ${x1} ${y1} L ${x2} ${y2}`,undefined,paint,width);
  const rect=(name:string,x:number,y:number,w:number,h:number,paint:SolidPaintIR)=>{root.children.push({...ctx.base(name,Math.max(.01,w),Math.max(.01,h)),kind:"rectangle",bounds:{x,y,width:Math.max(.01,w),height:Math.max(.01,h)},fill:paint});};
  const marker=(x:number,y:number,paint:SolidPaintIR,r=3)=>{root.children.push({...ctx.base("Data marker",r*2,r*2),kind:"ellipse",bounds:{x:x-r,y:y-r,width:r*2,height:r*2},fill:paint});};
  const title=cc(chart,"title"),titleTx=cc(title,"tx"),rich=cc(titleTx,"rich");
  const titleText=rich?.textContent?.trim()??cc(cc(cc(titleTx,"strRef"),"strCache"),"pt")?.textContent?.trim();
  const top=titleText?Math.max(34,textSize*2.5):15;
  if(titleText){
    const richText=rich?drawingText(rich,ctx,ctx.width-30,top,{lIns:"0",rIns:"0",tIns:"0",bIns:"0"}):undefined;
    if(richText)root.children.push({...ctx.base("Chart title",ctx.width-30,top),...richText,bounds:{x:15,y:0,width:ctx.width-30,height:top}});
    else addLabel(titleText,15,0,ctx.width-30,top,"CENTER",Math.max(textSize,18*ctx.scaleY));
  }
  const legend=cc(chart,"legend"),legendPosition=value(legend,"legendPos","r");
  const circular=groups.length===1&&["pieChart","doughnutChart"].includes(groups[0]!.family);
  const legendItems=circular?(series[0]?.categories.length?series[0]!.categories:series[0]?.values.map((_,i)=>String(i+1))??[]):series.map(s=>s.name);
  const showLegend=Boolean(legend)&&legendItems.length>0;
  const sideLegend=showLegend&&["l","r","tr"].includes(legendPosition);
  const legendWidth=sideLegend?Math.min(ctx.width*.27,Math.max(70,Math.max(...legendItems.map(s=>s.length))*textSize*.5+24)):0;
  const legendHeight=showLegend&&!sideLegend?Math.min(ctx.height*.3,Math.max(25,Math.ceil(legendItems.length/3)*(textSize+8))):0;
  let left=(sideLegend&&legendPosition==="l"?legendWidth:0)+Math.max(72,textSize*5),right=ctx.width-15-(sideLegend&&legendPosition!=="l"?legendWidth:0);
  let ytop=top+(showLegend&&legendPosition==="t"?legendHeight:0),bottom=ctx.height-Math.max(60,textSize*5)-(showLegend&&legendPosition!=="t"&&!sideLegend?legendHeight:0);
  const manual=cc(cc(plot,"layout"),"manualLayout");
  if(manual){
    const mx=number(cc(manual,"x"),"val",NaN),my=number(cc(manual,"y"),"val",NaN),mw=number(cc(manual,"w"),"val",NaN),mh=number(cc(manual,"h"),"val",NaN);
    if([mx,my,mw,mh].every(Number.isFinite)&&mx>=0&&my>=0&&mw>0&&mh>0&&mx+mw<=1&&my+mh<=1){left=mx*ctx.width;ytop=my*ctx.height;right=(mx+mw)*ctx.width;bottom=(my+mh)*ctx.height;}
  }
  if(right<=left+10||bottom<=ytop+10)throw new Error("invalid-file");
  const plotW=right-left,plotH=bottom-ytop;
  const plotFill=fill(cc(plot,"spPr"),ctx.appearance,warnPaint);if(plotFill)rect("Plot background",left,ytop,plotW,plotH,plotFill);
  const axes=ck(plot).filter(e=>["valAx","catAx","dateAx"].includes(e.localName)),valueAxes=axes.filter(e=>e.localName==="valAx");
  const scatter=groups.length===1&&["scatterChart","bubbleChart"].includes(groups[0]!.family);
  const unsupported=groups.length===0||groups.some(g=>!supported.has(g.family))||groups.length>1&&groups.some(g=>!["barChart","lineChart","areaChart"].includes(g.family))||(!scatter&&valueAxes.length>1)||groups.some(g=>g.family==="pieChart"&&g.series.length>1)||axes.some(a=>cc(cc(a,"scaling"),"logBase"));
  if(unsupported){ctx.warn("pptx-chart-unsupported");dataFallback();return root;}
  if(!series.some(s=>s.values.some(v=>v!==null))){ctx.warn("pptx-chart-data");addLabel("Chart data unavailable",left,ytop,plotW,plotH,"CENTER");return root;}
  for(const g of groups){
    if(cc(g.source,"extLst")||ck(g.source).some(e=>["dropLines","hiLowLines","upDownBars"].includes(e.localName)))ctx.warn("pptx-chart-style");
    for(const s of g.series)if(ck(s.source).some(e=>["trendline","errBars","pictureOptions"].includes(e.localName))||value(s.source,"smooth","0")==="1")ctx.warn("pptx-chart-style");
  }
  const categories=series.reduce((best,s)=>s.categories.length>best.length?s.categories:best,[] as string[]);
  const count=Math.max(...series.map(s=>s.values.length),categories.length);
  const horizontal=groups.some(g=>g.family==="barChart"&&value(g.source,"barDir","col")==="bar");
  if(horizontal&&groups.some(g=>g.family!=="barChart"||value(g.source,"barDir","col")!=="bar")){ctx.warn("pptx-chart-unsupported");dataFallback();return root;}
  const scaledGroups=groups.map(group=>{
    const stacked=["stacked","percentStacked"].includes(group.grouping);
    const totals=Array.from({length:count},(_,i)=>group.series.reduce((sum,s)=>sum+Math.abs(s.values[i]??0),0));
    return {group,stacked,values:group.series.map(s=>Array.from({length:count},(_,i)=>{const n=s.values[i];if(n===undefined||n===null)return value(chart,"dispBlanksAs","gap")==="zero"?0:null;return group.grouping==="percentStacked"?(totals[i]?n/totals[i]!:0):n;}))};
  });
  const extent:number[]=[0];
  for(const {values,stacked} of scaledGroups){
    if(stacked)for(let i=0;i<count;i++){extent.push(values.reduce((sum,vs)=>sum+Math.max(0,vs[i]??0),0),values.reduce((sum,vs)=>sum+Math.min(0,vs[i]??0),0));}
    else for(const vs of values)extent.push(...vs.filter((n):n is number=>n!==null));
  }
  const valAxis=scatter?valueAxes.find(a=>["l","r"].includes(value(a,"axPos")))??valueAxes[1]:valueAxes[0];
  const catAxis=axes.find(a=>a.localName==="catAx"||a.localName==="dateAx");
  if(catAxis?.localName==="dateAx")ctx.warn("pptx-chart-format");
  const range=axisRange(extent,valAxis),reverse=value(cc(valAxis,"scaling"),"orientation","minMax")==="maxMin";
  const project=(n:number)=>{const f=(n-range.min)/(range.max-range.min);return horizontal?left+(reverse?1-f:f)*plotW:bottom-(reverse?1-f:f)*plotH;};
  const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
  
  const reverseCategories=value(cc(catAxis,"scaling"),"orientation","minMax")==="maxMin";
  const category=(i:number)=>{const fraction=(i+.5)/count;return horizontal?bottom-(reverseCategories?1-fraction:fraction)*plotH:left+(reverseCategories?1-fraction:fraction)*plotW;};
  if(!circular&&groups[0]?.family!=="radarChart"){
    for(const tick of ticks(range)){
      const at=project(tick),axisFormat=cc(valAxis,"numFmt")?.getAttribute("formatCode")??(groups.every(g=>g.grouping==="percentStacked")?"0%":"General");
      if(cc(valAxis,"majorGridlines"))horizontal?line("Gridline",at,ytop,at,bottom,gridPaint):line("Gridline",left,at,right,at,gridPaint);
      if(value(valAxis,"delete","0")!=="1")horizontal?addLabel(formatted(tick,axisFormat,ctx.warn),at-30,bottom+4,60,textSize*1.5,"CENTER"):addLabel(formatted(tick,axisFormat,ctx.warn),left-65,at-textSize,58,textSize*2,"RIGHT");
    }
    if(value(valAxis,"delete","0")!=="1"){if(horizontal)line("Value axis",left,bottom,right,bottom);else line("Value axis",left,ytop,left,bottom);}
    if(value(catAxis,"delete","0")!=="1"){const cross=number(cc(valAxis,"crossesAt"),"val",value(valAxis,"crosses")==="max"?range.max:0),at=project(clamp(cross,range.min,range.max));if(horizontal)line("Category axis",at,ytop,at,bottom);else line("Category axis",left,at,right,at);}
    if(!scatter&&value(catAxis,"delete","0")!=="1")for(let i=0;i<count;i++){
      const cat=categories[i]??String(i+1),at=category(i);
      horizontal?addLabel(cat,0,at-textSize,Math.max(10,left-8),textSize*2,"RIGHT"):addLabel(cat,at-plotW/count/2,bottom+3,plotW/count,textSize*2,"CENTER");
    }
  }
  const dataLabel=(group:ChartGroup,s:ChartSeries,i:number,x:number,y:number,n:number,total?:number)=>{
    const configs=[cc(group.source,"dLbls"),cc(s.source,"dLbls")];
    let showVal=false,showCat=false,showSeries=false,showPercent=false,deleted=false,format=s.format,separator=" ";
    const point=ck(configs[1]??configs[0]).find(e=>e.localName==="dLbl"&&number(cc(e,"idx"),"val",-1)===i);
    for(const config of [...configs,point]){if(!config)continue;showVal=value(config,"showVal",showVal?"1":"0")==="1";showCat=value(config,"showCatName",showCat?"1":"0")==="1";showSeries=value(config,"showSerName",showSeries?"1":"0")==="1";showPercent=value(config,"showPercent",showPercent?"1":"0")==="1";deleted=value(config,"delete",deleted?"1":"0")==="1";format=cc(config,"numFmt")?.getAttribute("formatCode")??format;separator=cc(config,"separator")?.textContent??separator;}
    const bits=[showSeries?s.name:"",showCat?s.categories[i]??String(i+1):"",showVal?formatted(n,format,ctx.warn):"",showPercent&&total?formatted(Math.abs(n)/total,"0%",ctx.warn):""].filter(Boolean);
    if(!deleted&&bits.length){const text=bits.join(separator),width=Math.min(140,Math.max(30,text.length*textSize*.6));const node=addLabel(text,x-width/2,y-textSize,width,textSize*2,"CENTER");node.name="Data label";dataLabels.push(node);labelAnchors.set(node,{x,y});}
  };
  if(circular){
    const group=groups[0]!,rings=group.family==="doughnutChart"?group.series.length:1;
    const cx=(left+right)/2,cy=(ytop+bottom)/2,radius=Math.min(plotW,plotH)*.44;
    const hole=group.family==="doughnutChart"?clamp(number(cc(group.source,"holeSize"),"val",50)/100,.1,.9):0;
    for(let sidx=0;sidx<rings;sidx++){
      const s=group.series[sidx]!,total=s.values.reduce<number>((sum,v)=>sum+Math.abs(v??0),0);
      if(!total)continue;
      let start=(number(cc(group.source,"firstSliceAng"),"val",0)-90)*Math.PI/180;
      const outer=radius-(radius-radius*hole)*sidx/rings,inner=group.family==="doughnutChart"?radius-(radius-radius*hole)*(sidx+1)/rings:0;
      for(let i=0;i<s.values.length;i++){
        const n=s.values[i];if(n===null||n===undefined||n===0)continue;
        const end=start+Math.abs(n)/total*Math.PI*2,mid=(start+end)/2;
        const point=ck(s.source).find(e=>e.localName==="dPt"&&number(cc(e,"idx"),"val",-1)===i);
        const explosion=clamp(number(cc(point,"explosion"),"val",number(cc(s.source,"explosion"),"val",0)),0,100)/100*radius;
        shapePath("Pie slice",sector(cx+Math.cos(mid)*explosion,cy+Math.sin(mid)*explosion,outer,inner,start,end),paintFor(s,i,i));
        dataLabel(group,s,i,cx+Math.cos(mid)*(inner+outer)/2,cy+Math.sin(mid)*(inner+outer)/2,n,total);
        start=end;
      }
    }
  }else if(groups.length===1&&groups[0]!.family==="radarChart"){
    const group=groups[0]!,cx=(left+right)/2,cy=(ytop+bottom)/2,radius=Math.min(plotW,plotH)*.38;
    const max=Math.max(...series.flatMap(s=>s.values.filter((n):n is number=>n!==null)),1);
    if(series.some(s=>s.values.some(v=>v!==null&&v<0))){ctx.warn("pptx-chart-unsupported");dataFallback();return root;}
    const point=(i:number,n:number)=>[cx+Math.cos(i/count*2*Math.PI-Math.PI/2)*radius*n/max,cy+Math.sin(i/count*2*Math.PI-Math.PI/2)*radius*n/max];
    for(let i=0;i<count;i++){const p=point(i,max);line("Radar spoke",cx,cy,p[0]!,p[1]!,gridPaint);const t=point(i,max*1.18);addLabel(categories[i]??String(i+1),t[0]!-45,t[1]!-textSize,90,textSize*2,"CENTER");}
    for(let level=1;level<=4;level++){const pts=Array.from({length:count},(_,i)=>point(i,max*level/4));shapePath("Radar grid",polyline(pts,true),undefined,gridPaint);}
    for(const [idx,s]of group.series.entries()){const points=s.values.map((n,i)=>n===null?null:point(i,n));const paint=paintFor(s,idx);if(points.every((p):p is number[]=>p!==null))shapePath("Radar series",polyline(points,true),value(group.source,"radarStyle")==="filled"?{...paint,color:{...paint.color,a:.3}}:undefined,paint,2);else ctx.warn("pptx-chart-data");for(const [i,p]of points.entries())if(p){marker(p[0]!,p[1]!,paint);dataLabel(group,s,i,p[0]!,p[1]!,s.values[i]!);}}
  }else if(scatter){
    const group=groups[0]!,xAxis=valueAxes.find(a=>["b","t"].includes(value(a,"axPos")))??valueAxes[0];
    const xrange=axisRange(series.flatMap(s=>s.x.filter((n):n is number=>n!==null)),xAxis);
    const xreverse=value(cc(xAxis,"scaling"),"orientation","minMax")==="maxMin";
    const px=(n:number)=>left+(xreverse?1-(n-xrange.min)/(xrange.max-xrange.min):(n-xrange.min)/(xrange.max-xrange.min))*plotW;
    for(const tick of ticks(xrange))addLabel(formatted(tick,cc(xAxis,"numFmt")?.getAttribute("formatCode")??"General",ctx.warn),px(tick)-30,bottom+3,60,textSize*2,"CENTER");
    const maxSize=Math.max(...series.flatMap(s=>s.sizes.filter((n):n is number=>n!==null)),1);
    for(const [idx,s]of series.entries()){
      const paint=paintFor(s,idx),points:(number[]|null)[]=s.values.map((n,i)=>n===null||s.x[i]===null||s.x[i]===undefined?null:[px(s.x[i]!),project(n)]);
      const style=value(group.source,"scatterStyle","marker");
      if(style.startsWith("smooth"))warnPaint();
      if(s.values.some((v,i)=>v!==null&&(s.x[i]===null||s.x[i]===undefined)))ctx.warn("pptx-chart-data");
      if(group.family==="scatterChart"&&style!=="marker"&&style!=="none")for(const segment of segments(points))if(segment.length>1)shapePath("Scatter series",polyline(segment),undefined,paint,2);
      for(const [i,p]of points.entries())if(p){if(group.family==="bubbleChart"){const size=s.sizes[i];if(size===null||size===undefined||size<=0){ctx.warn("pptx-chart-data");continue;}marker(p[0]!,p[1]!,paint,Math.max(1,Math.sqrt(size/maxSize)*Math.min(plotW,plotH)*.09));}else if(!["line","smooth","none"].includes(style))marker(p[0]!,p[1]!,paint,3);dataLabel(group,s,i,p[0]!,p[1]!,s.values[i]!);}
    }
  }else{
    let seriesOffset=0;
    for(const {group,stacked,values}of scaledGroups){
      ctx.check();
      const pos=Array(count).fill(0) as number[],neg=Array(count).fill(0) as number[];
      for(const [sidx,s]of group.series.entries()){
        const paint=paintFor(s,seriesOffset+sidx),vs=values[sidx]!;
        const lows:number[]=[],highs:(number|null)[]=[];
        for(let i=0;i<count;i++){const n=vs[i];if(n===null||n===undefined){lows.push(0);highs.push(null);continue;}const low=stacked?(n>=0?pos[i]!:neg[i]!):0;const high=low+n;lows.push(low);highs.push(high);if(stacked){if(n>=0)pos[i]=high;else neg[i]=high;}}
        if(group.family==="barChart"){
          const gap=clamp(number(cc(group.source,"gapWidth"),"val",150),0,500)/100;
          const band=(horizontal?plotH:plotW)/count,available=band/(1+gap),barSize=available/(stacked?1:group.series.length);
          for(let i=0;i<count;i++){const high=highs[i];if(high===null||high===undefined)continue;const lo=project(clamp(lows[i]!,range.min,range.max)),hi=project(clamp(high,range.min,range.max));const middle=category(i)-available/2+(stacked?0:sidx*barSize),barPaint=paintFor(s,seriesOffset+sidx,i);
            if(Math.abs(hi-lo)>.001)horizontal?rect("Bar",Math.min(lo,hi),middle,Math.abs(hi-lo),barSize,barPaint):rect("Column",middle,Math.min(lo,hi),barSize,Math.abs(hi-lo),barPaint);
            dataLabel(group,s,i,horizontal?hi+(high>=0?20:-20):middle+barSize/2,horizontal?middle+barSize/2:hi+(high>=0?-textSize:textSize),s.values[i]??0);
          }
        }else{
          const points=highs.map((n,i)=>n===null?null:[category(i),project(n)]);
          const joined=value(chart,"dispBlanksAs","gap")==="span"?points.filter((p):p is number[]=>p!==null):points;
          if(group.family==="areaChart"){
            for(const indexes of indexSegments(points)){if(indexes.length<2)continue;const upper=indexes.map(i=>points[i]!),lower=[...indexes].reverse().map(i=>[category(i),project(clamp(stacked?lows[i]!:0,range.min,range.max))]);shapePath("Area series",polyline([...upper,...lower],true),paint);}
          }else for(const segment of segments(joined))if(segment.length>1)shapePath("Line series",polyline(segment),undefined,fill(child(cc(s.source,"spPr"),"ln"),ctx.appearance,warnPaint)??paint,Math.max(.1,number(child(cc(s.source,"spPr"),"ln"),"w",19050)/9525*ctx.scaleY));
          for(const [i,p]of points.entries())if(p){const symbol=value(cc(s.source,"marker"),"symbol","none");if(!["none","circle"].includes(symbol))warnPaint();if(symbol!=="none")marker(p[0]!,p[1]!,paint,Math.max(1,number(cc(cc(s.source,"marker"),"size"),"val",5)*ctx.scaleY/2));dataLabel(group,s,i,p[0]!,p[1]!-(highs[i]!>=0?textSize:-textSize),s.values[i]??0);}
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      seriesOffset+=group.series.length;
    }
  }
  if(showLegend){
    const deleted=new Set(ck(legend).filter(e=>e.localName==="legendEntry"&&value(e,"delete","0")==="1").map(e=>number(cc(e,"idx"),"val",-1)));
    for(const [i,name]of legendItems.entries()){
      if(deleted.has(i))continue;
      const x=sideLegend?(legendPosition==="l"?5:right+10):15+(i%3)*(ctx.width-30)/3;
      const y=sideLegend?ytop+i*(textSize+8):(legendPosition==="t"?top:ctx.height-legendHeight)+Math.floor(i/3)*(textSize+8);
      if(y+textSize>ctx.height)ctx.warn("pptx-chart-layout");
      const paint=circular?paintFor(series[0]!,i,i):paintFor(series[i]!,i);
      rect("Legend key",x,y+4,10,10,paint);addLabel(name,x+15,y,(sideLegend?legendWidth:(ctx.width-30)/3)-20,textSize+8);
    }
  }
  if(!placeChartLabels(dataLabels,{x:left,y:ytop,width:plotW,height:plotH}))ctx.warn("pptx-chart-layout");
  for(const label of dataLabels){const anchor=labelAnchors.get(label)!,b=label.bounds;if(anchor.x<b.x||anchor.x>b.x+b.width||anchor.y<b.y||anchor.y>b.y+b.height)line("Data label leader",anchor.x,anchor.y,Math.max(b.x,Math.min(b.x+b.width,anchor.x)),Math.max(b.y,Math.min(b.y+b.height,anchor.y)),gridPaint,.75);}
  for(const axis of axes){const title=cc(axis,"title"),rich=cc(cc(title,"tx"),"rich"),text=rich?Array.from(rich.getElementsByTagNameNS(A,"t")).map(t=>t.textContent??"").join(""):cc(cc(cc(cc(title,"tx"),"strRef"),"strCache"),"pt")?.textContent;
    if(!text)continue;const vertical=["l","r"].includes(value(axis,"axPos","l"));
    const node=vertical?addLabel(text,0,ytop,Math.max(12,left-8),plotH,"CENTER"):addLabel(text,left,bottom+textSize*2.8,plotW,textSize*1.5,"CENTER");node.name="Axis title";
    if(vertical){node.bounds={x:(sideLegend&&legendPosition==="l"?legendWidth:0)+10-plotH/2,y:ytop+plotH/2-textSize,width:plotH,height:textSize*2};node.rotation=270;node.centeredTransform={flipH:false,flipV:false};}
  }
  ctx.check();return root;

  function dataFallback():void{
    // Retain source values as editable text when the visual chart family is unsupported.
    root.children=root.children.filter(e=>e.name==="Chart background"||e.name==="Chart title");
    addLabel("Chart data — visual style unsupported",15,top,ctx.width-30,24,"LEFT",Math.min(textSize,14));
    let y=top+28;
    const rows=series.reduce((n,s)=>n+s.values.length,0);
    if(rows>2000)throw new Error("security-limit");
    const h=Math.max(10,Math.min(textSize+5,(ctx.height-y)/Math.max(1,rows)));
    if(!series.length){addLabel("No readable chart data",15,y,ctx.width-30,24);return;}
    for(const s of series)for(let i=0;i<s.values.length;i++){
      const v=s.values[i];const text=`${s.name} · ${s.categories[i]??String(i+1)}: ${v===null||v===undefined?"—":String(v)}`;
      addLabel(text,15,y,ctx.width-30,h,"LEFT",Math.min(textSize,h*.75));y+=h;
    }
  }
}
interface AxisRange{min:number;max:number;step:number}
function axisRange(values:number[],axis:Element|undefined):AxisRange{
  const scaling=cc(axis,"scaling");
  let min=number(cc(scaling,"min"),"val",Math.min(0,...values)),max=number(cc(scaling,"max"),"val",Math.max(0,...values));
  if(!Number.isFinite(min)||!Number.isFinite(max)||min>max)throw new Error("invalid-file");
  if(min===max){min=Math.min(0,min);max=max===0?1:max+Math.abs(max)*.1;if(min===max)max=min+1;}
  const rough=(max-min)/5,unit=10**Math.floor(Math.log10(rough)),factor=rough/unit;
  const step=number(cc(axis,"majorUnit"),"val",(factor<=1?1:factor<=2?2:factor<=5?5:10)*unit);
  if(step<=0||!Number.isFinite(step)||(max-min)/step>100)throw new Error("security-limit");
  if(!cc(scaling,"min"))min=Math.floor(min/step)*step;if(!cc(scaling,"max"))max=Math.ceil(max/step)*step;
  return {min,max,step};
}
function ticks(range:AxisRange):number[]{const out:number[]=[];for(let i=0;i<=100;i++){const n=Math.ceil(range.min/range.step)*range.step+i*range.step;if(n>range.max+range.step*.00001)break;out.push(Math.abs(n)<range.step*1e-10?0:n);}return out;}
function polyline(points:number[][],close=false):string{return points.map((p,i)=>`${i?"L":"M"} ${p[0]} ${p[1]}`).join(" ")+(close?" Z":"");}
function indexSegments(points:(number[]|null)[]):number[][]{const result:number[][]=[];let current:number[]=[];for(const [i,p]of points.entries()){if(p)current.push(i);else if(current.length){result.push(current);current=[];}}if(current.length)result.push(current);return result;}
function segments(points:(number[]|null)[]):number[][][]{return indexSegments(points).map(indices=>indices.map(i=>points[i]!));}
function sector(cx:number,cy:number,outer:number,inner:number,start:number,end:number):string{
  // Cubic arcs keep slices editable and stay inside Figma's supported path grammar.
  const arc=(r:number,a:number,b:number)=>{let data="";const steps=Math.max(1,Math.ceil(Math.abs(b-a)/(Math.PI/2)));for(let i=0;i<steps;i++){const t=a+(b-a)*i/steps,u=a+(b-a)*(i+1)/steps,k=4/3*Math.tan((u-t)/4);data+=` C ${cx+r*(Math.cos(t)-k*Math.sin(t))} ${cy+r*(Math.sin(t)+k*Math.cos(t))} ${cx+r*(Math.cos(u)+k*Math.sin(u))} ${cy+r*(Math.sin(u)-k*Math.cos(u))} ${cx+r*Math.cos(u)} ${cy+r*Math.sin(u)}`;}return data;};
  let data=`M ${cx+outer*Math.cos(start)} ${cy+outer*Math.sin(start)}`+arc(outer,start,end);
  if(inner>0)data+=` L ${cx+inner*Math.cos(end)} ${cy+inner*Math.sin(end)}`+arc(inner,end,start);else data+=` L ${cx} ${cy}`;
  return data+" Z";
}
