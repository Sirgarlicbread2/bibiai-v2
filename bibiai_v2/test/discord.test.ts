import { vi,describe,it,expect } from 'vitest';
import { Configuration } from '../src/config.js';
import { Discord } from '../src/discord.js';
function fixture(){
  const cfg=new Configuration();cfg.value.discord.guildId='100000000000000001';cfg.value.discord.privacyRole='100000000000000002';cfg.value.discord.channels=['channel'];
  const disk:any={ready:true,blocked:()=>false,allowed:()=>true,forget:vi.fn(),rows:vi.fn(async()=>[]),put:vi.fn()};
  const memory:any={recent:vi.fn(),fact:vi.fn(),grudge:vi.fn()};const ai:any={chat:vi.fn(),gate:{busy:false}};
  const mc:any={execute:vi.fn()};const bot=new Discord(cfg,disk,memory,ai,mc);
  (bot as any).ready=true;bot.client={user:{id:'bot'},users:{cache:{delete:vi.fn()}}}as any;
  return{bot,disk,memory,ai,mc};
}
describe('Discord privacy enforcement',()=>{
  it('never reads message content or runs features for an excluded member',async()=>{
    const f=fixture();vi.spyOn(f.bot.privacy,'message').mockResolvedValue(false);
    const message:any={author:{id:'100000000000000003',bot:false},channelId:'channel',guild:{},get content(){throw new Error('Content must not be read');}};
    await (f.bot as any).onMessage(message);
    expect(f.ai.chat).not.toHaveBeenCalled();expect(f.memory.recent).not.toHaveBeenCalled();expect(f.disk.put).not.toHaveBeenCalled();
  });
  it('ignores excluded slash commands before reading their options',async()=>{
    const f=fixture();vi.spyOn(f.bot.privacy,'member').mockResolvedValue(null);
    const i:any={isChatInputCommand:()=>true,commandName:'ask',channelId:'channel',guild:{},user:{id:'100000000000000003'},get options(){throw new Error('Options must not be read');}};
    await (f.bot as any).onInteraction(i);expect(f.ai.chat).not.toHaveBeenCalled();expect(f.disk.put).not.toHaveBeenCalled();
  });
  it('sets exclusion without attempting a prior NAS read',async()=>{
    const f=fixture();f.disk.rows.mockRejectedValue(new Error('NAS unavailable'));
    await f.bot.forget('100000000000000003');expect(f.disk.forget).toHaveBeenCalledWith('100000000000000003',expect.any(Function));expect(f.disk.rows).not.toHaveBeenCalled();
  });
  it('invalidates pending commands belonging to a forgotten subject',async()=>{
    const f=fixture();(f.bot as any).pending.set('plan',{owner:'a',subjects:['a','b'],commands:['stop'],at:Date.now(),channel:'channel'});
    await f.bot.forget('b');expect((f.bot as any).pending.size).toBe(0);expect(f.mc.execute).not.toHaveBeenCalled();
  });
  it('does not mistake message-link IDs for member mentions',async()=>{
    const f=fixture();const member=vi.spyOn(f.bot.privacy,'member').mockResolvedValue(null);
    expect(await f.bot.privacy.text({}as any,'https://discord.com/channels/100000000000000001/100000000000000004/100000000000000005')).toBe(true);expect(member).not.toHaveBeenCalled();
    expect(await f.bot.privacy.text({client:{user:{id:'bot'}}}as any,'<@100000000000000003>')).toBe(false);
  });
});
