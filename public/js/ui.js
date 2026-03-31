const stars = document.getElementById('stars');
if (stars) {
  const ctx = stars.getContext('2d');
  let width, height, points;
  function resize(){
    width = stars.width = window.innerWidth;
    height = stars.height = window.innerHeight;
    points = Array.from({length: Math.max(60, Math.floor(width/22))}, () => ({
      x: Math.random()*width,
      y: Math.random()*height,
      r: Math.random()*1.8 + 0.3,
      s: Math.random()*0.25 + 0.05
    }));
  }
  function draw(){
    ctx.clearRect(0,0,width,height);
    for(const p of points){
      p.y += p.s;
      if(p.y > height) { p.y = -5; p.x = Math.random()*width; }
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  resize(); draw(); addEventListener('resize', resize);
}
const glow = document.getElementById('cursorGlow');
if (glow) addEventListener('pointermove', e => { glow.style.left = e.clientX + 'px'; glow.style.top = e.clientY + 'px'; });

function setFlash(message, type = 'error') {
  const flash = document.getElementById('flash');
  if (!flash) return;
  flash.textContent = message;
  flash.className = `flash show ${type}`;
}
