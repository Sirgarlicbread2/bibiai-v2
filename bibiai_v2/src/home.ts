import type { Configuration } from './config.js';
import { jsonRequest, jsonPost } from './net.js';
export class Home {
  constructor(readonly cfg: Configuration) {}
  private url(path:string) {
    if (!this.cfg.value.home.enabled || !this.cfg.secrets.home_token) throw new Error('Home Assistant is not configured.');
    return this.cfg.value.home.url.replace(/\/$/,'') + '/api/' + path;
  }
  async states() {
    const states=[];
    for (const id of this.cfg.value.home.entities) {
      const r = await jsonRequest(this.url(`states/${encodeURIComponent(id)}`), {headers:{Authorization:`Bearer ${this.cfg.secrets.home_token}`}},16384);
      states.push({entityId:id,state:String(r.state).slice(0,200),name:String(r.attributes?.friendly_name || id).slice(0,100)});
    }
    return states;
  }
  async act(name:string) {
    const a = this.cfg.value.home.actions.find(a=>a.name===name);
    if (!a) throw new Error('This Home Assistant action is not allowlisted.');
    const [domain,service] = a.service.split('.');
    await jsonRequest(this.url(`services/${domain}/${service}`),jsonPost({entity_id:a.entityId},{Authorization:`Bearer ${this.cfg.secrets.home_token}`}),32768);
    return `Requested ${name}.`;
  }
}
