import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VoiceBasedChannel } from 'discord.js';
import type { Configuration } from './config.js';
const execute=promisify(execFile);
export class Voice {
  private connection:any;
  private child:ChildProcess|undefined;
  private player:any;
  private last=0;
  private busy=false;
  private generation=0;
  private captureCancel:(()=>void)|undefined;
  constructor(readonly cfg:Configuration){}
  leave(){this.generation++;this.captureCancel?.();this.child?.kill();this.player?.stop();this.connection?.destroy();this.connection=undefined;this.busy=false;}
  private begin(){
    if(this.busy)throw new Error('Voice is busy.');
    if(Date.now()-this.last<this.cfg.value.discord.voiceCooldownSeconds*1000)throw new Error('Voice cooldown is active.');
    this.busy=true;this.last=Date.now();
    return ++this.generation;
  }
  private check(ticket:number){if(!this.busy||ticket!==this.generation)throw new Error('Voice operation cancelled.');}
  private async connect(channel:VoiceBasedChannel,listening:boolean,ticket:number){
    const v=await import('@discordjs/voice');
    this.check(ticket);
    this.connection=v.joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:!listening});
    await v.entersState(this.connection,v.VoiceConnectionStatus.Ready,15000);this.check(ticket);return v;
  }
  async play(channel:VoiceBasedChannel,path:string){
    const ticket=this.begin();
    try{
      const v=await this.connect(channel,false,ticket);
      this.child=spawn('ffmpeg',['-nostdin','-loglevel','error','-i',path,'-f','s16le','-ar','48000','-ac','2','pipe:1'],{stdio:['ignore','pipe','ignore'],windowsHide:true});
      this.player=v.createAudioPlayer();
      const resource=v.createAudioResource(this.child.stdout!,{inputType:v.StreamType.Raw});
      this.connection.subscribe(this.player);this.player.play(resource);
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('Voice playback timeout.'));},180000);
        const cleanup=()=>{clearTimeout(timer);this.player?.removeAllListeners(v.AudioPlayerStatus.Idle);};
        this.player.once(v.AudioPlayerStatus.Idle,()=>{cleanup();resolve();});this.player.once('error',()=>{cleanup();reject(new Error('Audio playback failed.'));});
        this.child!.once('error',()=>{cleanup();reject(new Error('Audio program is unavailable.'));});
      });
    }finally{if(ticket===this.generation)this.leave();}
  }
  async say(channel:VoiceBasedChannel,text:string){
    if(!this.cfg.value.discord.tts)throw new Error('TTS is disabled.');
    const folder=await mkdtemp(join(tmpdir(),'bibiai-voice-'));
    try{
      const c=this.cfg.value.discord,path=join(folder,'speech.wav');
      await execute('espeak-ng',['-v',c.ttsVoice,'-s',String(c.ttsSpeed),'-p',String(c.ttsPitch),'-w',path,'--',text.replace(/<[^>]+>/g,'').slice(0,300)],{timeout:15000,windowsHide:true,maxBuffer:1024});
      await this.play(channel,path);
    }finally{await rm(folder,{recursive:true,force:true});}
  }
  async listen(channel:VoiceBasedChannel,userId:string,allowed:()=>Promise<boolean>){
    if(!this.cfg.value.discord.stt)throw new Error('Speech input is disabled.');
    if(!await allowed())throw new Error('Privacy preference prevents voice capture.');
    const ticket=this.begin();
    try{
      const v=await this.connect(channel,true,ticket);
      const {default:Opus}=await import('opusscript');
      this.check(ticket);
      const decoder=new Opus(48000,2,Opus.Application.AUDIO);
      const chunks:Buffer[]=[];let size=0;
      try{
        const stream=this.connection.receiver.subscribe(userId,{end:{behavior:v.EndBehaviorType.AfterSilence,duration:1200}});
        await new Promise<void>((resolve,reject)=>{
          let finished=false;
          const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);stream.destroy();this.captureCancel=undefined;error?reject(error):resolve();};
          const timer=setTimeout(()=>finish(),15000);this.captureCancel=()=>finish(new Error('Voice capture cancelled.'));
          stream.on('data',(packet:Buffer)=>{try{const pcm=Buffer.from(decoder.decode(packet));size+=pcm.length;if(size>3*1024*1024){finish();return;}chunks.push(pcm);}catch{finish(new Error('Voice decoding failed.'));}});
          stream.once('end',()=>finish());stream.once('error',()=>finish(new Error('Voice capture failed.')));
        });
      }finally{decoder.delete();}
      if(!await allowed())throw new Error('Privacy preference changed during voice capture.');
      if(!size)throw new Error('No speech was captured.');
      const pcm=Buffer.concat(chunks),header=Buffer.alloc(44);
      header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(192000,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      return Buffer.concat([header,pcm]);
    }finally{if(ticket===this.generation)this.leave();}
  }
}
