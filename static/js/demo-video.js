import {createSeekableDemo, supportsSeekableDemo} from './demo-stream.mjs';

const demo=document.querySelector('.intro-standalone-video');
const button=document.querySelector('.demo-load');
const status=document.querySelector('.demo-status');
if(demo&&button&&status){
 demo.controls=false;
 let loading=false,generation=0,active=false,hasPlayed=false,resumeTime=0,timer;
 let stream=null,notice='';
 const clearTimer=()=>{clearTimeout(timer);timer=null;};
 function unload(){
  stream?.dispose();stream=null;
  demo.pause();demo.removeAttribute('src');demo.load();demo.controls=false;
 }
 function fail(message){
  if(!active)return;
  resumeTime=demo.currentTime||resumeTime;
  generation++;active=false;loading=false;clearTimer();unload();
  button.hidden=false;button.disabled=false;button.textContent='Retry demo';
  status.textContent=message+' Press Retry demo to try again.';
 }
 function watchForStall(){
  clearTimer();
  // Bound a stalled connection, not the time to download the whole movie.
  const ticket=generation;
  timer=setTimeout(()=>{
   if(ticket===generation&&active)fail('The video connection stopped responding.');
  },45000);
 }
 function pauseDemo(){
  const pending=loading;
  generation++;active=false;loading=false;clearTimer();demo.pause();
  if(pending){resumeTime=demo.currentTime||resumeTime;unload();}
  demo.preload='none';
  button.disabled=false;button.textContent='Watch';status.textContent='';
  if(!hasPlayed||pending)button.hidden=false;
 }
 button.addEventListener('click',async()=>{
  if(loading){pauseDemo();return;}
  const ticket=++generation;
  active=true;loading=true;button.disabled=false;button.textContent='Cancel loading';
  status.textContent='Loading video…';demo.preload='auto';
  if(!demo.hasAttribute('src')){
   if(window.origin==='null'&&supportsSeekableDemo()){
    const current=createSeekableDemo(demo,error=>{
     if(stream!==current)return;
     active=true;
     fail(`The seekable demo could not be loaded: ${error.message}`);
    });
    stream=current;
   }else{
    notice=window.origin==='null'?'This browser supports seeking only after the requested part has downloaded.':'';
    demo.dataset.delivery='native';
    demo.src=demo.dataset.src;
   }
  }
  watchForStall();
  try{
   // Keep playback attached to the click gesture while segments load asynchronously.
   await demo.play();
  }catch(error){
   if(ticket!==generation||!active)return;
   if(error.name==='NotAllowedError'||error.name==='AbortError'){
    active=false;loading=false;clearTimer();
    status.textContent='Press Watch to start the video.';button.textContent='Watch';button.hidden=false;
   }else{
    fail('The video could not be played.');
   }
  }
 });
 demo.addEventListener('loadedmetadata',()=>{
  if(active&&resumeTime){demo.currentTime=Math.min(resumeTime,demo.duration);resumeTime=0;}
 });
 demo.addEventListener('playing',()=>{
  if(demo.paused)return;
  if(!active){demo.pause();return;}
  loading=false;hasPlayed=true;resumeTime=0;clearTimer();
  button.hidden=true;button.textContent='Watch';status.textContent=notice;demo.controls=true;
 });
 demo.addEventListener('waiting',()=>{
  if(active&&!demo.paused){status.textContent='Buffering video…';watchForStall();}
 });
 demo.addEventListener('timeupdate',()=>{
  if(active&&!demo.paused&&demo.readyState>=3){clearTimer();status.textContent=notice;}
 });
 demo.addEventListener('pause',()=>{if(!loading){clearTimer();status.textContent=notice;}});
 demo.addEventListener('ended',()=>{clearTimer();status.textContent=notice;});
 demo.addEventListener('error',()=>{
  if(!active||!demo.error)return;
  const reason={2:'The video connection was interrupted.',3:'The browser could not decode this video.',4:'The video is unavailable or unsupported by this browser.'};
  fail(reason[demo.error.code]||'The video could not be loaded.');
 });
 demo.addEventListener('demo:pause',pauseDemo);
 demo.addEventListener('play',()=>{
  if(demo.paused)return;
  active=true;
  document.querySelectorAll('.application-preview').forEach(card=>card.dispatchEvent(new Event('preview:pause')));
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseDemo();});
 window.addEventListener('pagehide',event=>{
  pauseDemo();if(event.persisted)return;
  unload();
 });
}
