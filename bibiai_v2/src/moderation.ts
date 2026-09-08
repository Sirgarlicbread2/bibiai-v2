import type { Configuration } from './config.js';
import type { Storage } from './storage.js';
export type Severity=0|1|2|3;
export function classify(text:string,blocked:string[]=[]):{severity:Severity;rule:string}|null{
  const rules:Array<[RegExp,Severity,string]>=[[/\b(doxx?|ddos|leak (?:your|their) address|kill yourself|serious threat)\b/i,3,'Threat or personal information'],[/\b(porn|nsfw|nudes?|free nitro|steam gift|phishing)\b/i,2,'Explicit content or scam'],[/\b(edating|e-dating|harass|griefing)\b/i,1,'Disruption'],[/\b(bad bot|fatass|fat ass|fuck you|stupid bot|shut up bibi)\b/i,0,'Insult']];
  if(blocked.some(t=>text.toLowerCase().includes(t.toLowerCase())))return{severity:2,rule:'Configured blocked term'};
  for(const [pattern,severity,rule]of rules)if(pattern.test(text))return{severity,rule};return null;
}
export class Moderation {
  private activity=new Map<string,{at:number;count:number;duplicates:number;last:string;mentions:number}>();
  constructor(readonly cfg:Configuration,readonly disk:Storage){}
  forget(id:string){this.activity.delete(id);}
  async evaluate(id:string,text:string,mentionsBot:boolean,snitch=false){
    const c=this.cfg.value;
    let finding=classify(text,c.moderation.blockedTerms);
    if(!snitch){
      const now=Date.now(),old=this.activity.get(id);
      const a=old&&now-old.at<30000?old:{at:now,count:0,duplicates:0,last:'',mentions:0};
      a.count++;a.duplicates=text===a.last?a.duplicates+1:1;a.last=text.slice(0,200);if(mentionsBot)a.mentions++;
      if(this.activity.size>=500)this.activity.delete(this.activity.keys().next().value!);this.activity.set(id,a);
      if((mentionsBot&&a.mentions>=4)||(c.vacation.enabled&&(a.count>=8||a.duplicates>=4)))finding={severity:1,rule:'Repeated spam'};
      if(finding?.rule==='Insult'&&!mentionsBot)finding=null;
    }
    if(!finding)return null;
    const previous=this.disk.ready?(await this.disk.rows('event',1000,r=>r.data.type==='moderation'&&r.subjects.includes(id)&&r.at>Date.now()-c.moderation.repeatDays*86400000)).length:0;
    const severity=Math.min(3,finding.severity+Math.floor(previous/2))as Severity;
    const minutes=snitch?Math.round(c.moderation.snitchMinMinutes+(c.moderation.snitchMaxMinutes-c.moderation.snitchMinMinutes)*severity/3):c.vacation.enabled?c.vacation.timeouts[severity]:Math.min(c.moderation.timeoutMinutes,[1,2,5,5][severity]);
    return{...finding,severity,minutes,previous};
  }
  sweep(){for(const[id,r]of this.activity)if(Date.now()-r.at>60000)this.activity.delete(id);}
}
