import{a as e,i as t,n,r,t as i}from"./index-BlwmxHYj.js";var a=e(t(),1),o=i(),s=`#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,c=`#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uVel;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.5);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

  float t = uTime;
  float surge = clamp(uVel, 0.0, 1.8);

  // Base P1 CRT dark glass tint
  vec3 phosphor = vec3(0.102, 1.0, 0.251); // #1aff40
  vec3 mint     = vec3(0.62, 1.0, 0.72);
  vec3 col      = vec3(0.008, 0.042, 0.012);

  // Curved CRT center phosphor dome glow
  float r2 = dot(p * vec2(0.76, 1.0), p * vec2(0.76, 1.0));
  col += phosphor * exp(-r2 * 1.9) * 0.085;

  // Rolling vertical V-Sync refresh beam (accelerates subtly with scroll)
  float scanY = fract(1.0 - t * 0.14);
  float dy = uv.y - scanY;
  float wrappedDy = dy - floor(dy + 0.5);
  float beam = exp(-(wrappedDy * wrappedDy) * 140.0) * (0.14 + surge * 0.09);
  float beamTail = smoothstep(-0.20, 0.0, wrappedDy) * smoothstep(0.018, 0.0, wrappedDy) * 0.065;
  col += phosphor * (beam + beamTail);

  // Pip-Boy / RobCo tactical radar rings + rotating sweep sector
  float dist = length(p);
  float rf = fract(dist * 2.8 - t * 0.055) - 0.5;
  float ringA = exp(-(rf * rf) * 520.0);
  float angle = atan(p.y, p.x);
  float sweep = fract((angle + t * 0.42) / 6.2831853);
  float radarSector = smoothstep(0.72, 1.0, sweep) * smoothstep(0.95, 0.04, dist) * 0.085;
  float radarEdge   = smoothstep(0.985, 1.0, sweep) * smoothstep(0.95, 0.03, dist) * 0.18;
  col += phosphor * (ringA * 0.06 + radarSector) + mint * radarEdge;

  // Fine oscilloscope telemetry grid lines + major crosshairs etched into the tube
  vec2 grid = abs(fract(gl_FragCoord.xy / 48.0 - 0.5) - 0.5) * 48.0;
  float lineMask = 1.0 - min(min(grid.x, grid.y), 1.0);
  col += phosphor * lineMask * 0.052;
  float axisX = exp(-abs(p.x) * 320.0) * 0.06;
  float axisY = exp(-abs(p.y) * 320.0) * 0.06;
  col += phosphor * (axisX + axisY);

  // Interactive electron-gun cursor phosphor excitation + horizontal scan highlight
  float md = length(p - m);
  float hotspot = exp(-md * md * 6.5) * 0.16;
  float hLine = exp(-((uv.y - uMouse.y) * (uv.y - uMouse.y)) * 14000.0) * exp(-md * 1.9) * 0.09;
  col += mix(phosphor, mint, 0.35) * (hotspot + hLine);

  // Subtle high-frequency analog tube static grain
  float grain = (hash(gl_FragCoord.xy + floor(t * 24.0) * 13.7) - 0.5) * (0.03 + surge * 0.022);
  col += phosphor * max(grain, 0.0);

  // Authentic CRT glass edge falloff
  float vig = 1.0 - smoothstep(0.48, 1.32, length(p * vec2(0.82, 1.0)));
  col *= mix(0.58, 1.12, vig);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;function l(e,t,n){let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(e.deleteShader(r),null)):null}var u=`0123456789ABCDEF+:[]`,d=`sd-terminal-booted`,f=`sd-terminal-switched`;function p({theme:e}){let t=(0,a.useRef)(null),i=(0,a.useRef)(null),p=(0,a.useRef)(null),m=(0,a.useRef)(null),h=(0,a.useRef)({x:.5,y:.5,tx:.5,ty:.5,px:-999,py:-999}),g=(0,a.useRef)({current:0,target:0}),_=e===`terminal`;return(0,a.useEffect)(()=>{if(!_)return;let e=t.current;if(!e)return;let r=n(),i=!0,a=0,o=performance.now(),u=t=>{let n=e.getBoundingClientRect();if(!n.width||!n.height)return;let r=t.clientX-n.left,i=t.clientY-n.top;h.current.tx=Math.max(0,Math.min(1,r/n.width)),h.current.ty=Math.max(0,Math.min(1,1-i/n.height)),h.current.px=r,h.current.py=i},d=e=>{let t=Math.min(1.8,Math.abs(Number(e.detail)||0));t>g.current.target&&(g.current.target=t)};window.addEventListener(`pointermove`,u,{passive:!0}),window.addEventListener(`sd-scroll-velocity`,d);let f=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:`low-power`}),p=null,m=null;if(f){let t=l(f,f.VERTEX_SHADER,s),n=l(f,f.FRAGMENT_SHADER,c),a=t&&n?f.createProgram():null;if(a)if(f.attachShader(a,t),f.attachShader(a,n),f.bindAttribLocation(a,0,`aPos`),f.linkProgram(a),f.deleteShader(t),f.deleteShader(n),f.getProgramParameter(a,f.LINK_STATUS)){f.useProgram(a);let t=f.createBuffer();f.bindBuffer(f.ARRAY_BUFFER,t),f.bufferData(f.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),f.STATIC_DRAW),f.enableVertexAttribArray(0),f.vertexAttribPointer(0,2,f.FLOAT,!1,0,0);let n=f.getUniformLocation(a,`uRes`),s=f.getUniformLocation(a,`uTime`),c=f.getUniformLocation(a,`uMouse`),l=f.getUniformLocation(a,`uVel`),u=()=>{let t=Math.min(window.devicePixelRatio||1,1.5),n=Math.max(1,Math.floor(e.clientWidth*t)),r=Math.max(1,Math.floor(e.clientHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r)};u(),window.addEventListener(`resize`,u,{passive:!0});let d=e=>{e.preventDefault(),i=!1};e.addEventListener(`webglcontextlost`,d),m=t=>{u();let i=h.current;i.x+=(i.tx-i.x)*.09,i.y+=(i.ty-i.y)*.09,g.current.current+=(g.current.target-g.current.current)*.14,g.current.target*=.86,f.viewport(0,0,e.width,e.height),f.uniform2f(n,e.width,e.height),f.uniform1f(s,r?2.8:(t-o)/1e3),f.uniform2f(c,i.x,i.y),f.uniform1f(l,g.current.current),f.drawArrays(f.TRIANGLE_STRIP,0,4)},p=()=>{window.removeEventListener(`resize`,u),e.removeEventListener(`webglcontextlost`,d),f.deleteBuffer(t),f.deleteProgram(a)}}else f.deleteProgram(a)}if(!m){let t=e.getContext(`2d`);if(t){let n=()=>{let n=Math.min(window.devicePixelRatio||1,1.5);e.width=Math.max(1,Math.floor(e.clientWidth*n)),e.height=Math.max(1,Math.floor(e.clientHeight*n)),t.setTransform(n,0,0,n,0,0)};n(),window.addEventListener(`resize`,n,{passive:!0}),p=()=>window.removeEventListener(`resize`,n),m=i=>{let a=Math.min(window.devicePixelRatio||1,1.5),s=Math.max(1,Math.floor(e.clientWidth*a)),c=Math.max(1,Math.floor(e.clientHeight*a));(e.width!==s||e.height!==c)&&n();let l=e.clientWidth,u=e.clientHeight,d=r?1.5:(i-o)/1e3;t.fillStyle=`#020a02`,t.fillRect(0,0,l,u);let f=d*.14%1*u,p=t.createLinearGradient(0,f-70,0,f+24);p.addColorStop(0,`rgba(26,255,64,0)`),p.addColorStop(.78,`rgba(26,255,64,0.08)`),p.addColorStop(1,`rgba(26,255,64,0)`),t.fillStyle=p,t.fillRect(0,f-70,l,94)}}}let v=e=>{a=0,!(!i||!m)&&(document.hidden||m(e),r||(a=requestAnimationFrame(v)))},y=()=>{document.hidden&&a?(cancelAnimationFrame(a),a=0):!document.hidden&&!r&&!a&&i&&(a=requestAnimationFrame(v))};return document.addEventListener(`visibilitychange`,y),a=requestAnimationFrame(v),()=>{i=!1,a&&cancelAnimationFrame(a),document.removeEventListener(`visibilitychange`,y),window.removeEventListener(`pointermove`,u),window.removeEventListener(`sd-scroll-velocity`,d),p?.()}},[_]),(0,a.useEffect)(()=>{if(!_||n())return;let e=i.current;if(!e)return;let t=e.getContext(`2d`);if(!t)return;let r=!0,a=0,o=e.clientWidth,s=e.clientHeight,c=window.matchMedia?.(`(pointer: fine)`).matches,l=()=>{let n=Math.min(window.devicePixelRatio||1,2);o=e.clientWidth,s=e.clientHeight,e.width=Math.max(1,Math.floor(o*n)),e.height=Math.max(1,Math.floor(s*n)),t.setTransform(n,0,0,n,0,0)};l(),window.addEventListener(`resize`,l,{passive:!0});let d=Array.from({length:24},(e,t)=>({x:t*173.1%100/100*Math.max(o,300),y:t*293.7%100/100*Math.max(s,300),vy:-(.12+t%4*.05),ch:u[t%20],phase:t*.85})),f=[],p=t=>{let n=e.getBoundingClientRect(),r=t.clientX-n.left,i=t.clientY-n.top;r<0||i<0||r>n.width||i>n.height||(f.push({x:r,y:i,size:22,target:10,ringR:3,life:1}),f.length>8&&f.shift())};window.addEventListener(`pointerdown`,p,{passive:!0});let m=0,g=()=>{if(a=0,r){if(!document.hidden){(e.clientWidth!==o||e.clientHeight!==s)&&l(),m++,t.clearRect(0,0,o,s);let n=h.current.px,r=h.current.py;t.font=`10px "Share Tech Mono", monospace`;for(let e=0;e<d.length;e++){let i=d[e];i.y+=i.vy,i.y<-12&&(i.y=s+12,i.x=(i.x+157)%Math.max(o,1)),m%48==0&&(e+m)%7==0&&(i.ch=u[(e+m)%20]);let a=n>-100?Math.hypot(i.x-n,i.y-r):999,c=a<120?(1-a/120)*.42:0;t.fillStyle=`rgba(26, 255, 64, ${(.055+.04*Math.sin(m*.04+i.phase)+c).toFixed(3)})`,t.fillText(i.ch,i.x,i.y)}c&&n>0&&n<o&&r>0&&r<s&&(t.strokeStyle=`rgba(26, 255, 64, 0.55)`,t.lineWidth=1.5,t.beginPath(),t.moveTo(n,0),t.lineTo(n,7),t.moveTo(n,s),t.lineTo(n,s-7),t.moveTo(0,r),t.lineTo(7,r),t.moveTo(o,r),t.lineTo(o-7,r),t.stroke());for(let e=f.length-1;e>=0;e--){let n=f[e];if(n.size+=(n.target-n.size)*.24,n.ringR+=(30-n.ringR)*.16,n.life-=.045,n.life<=0){f.splice(e,1);continue}let r=n.size,i=5.5;t.strokeStyle=`rgba(43, 255, 82, ${(n.life*.85).toFixed(3)})`,t.lineWidth=1.5,t.beginPath(),t.moveTo(n.x-r,n.y-r+i),t.lineTo(n.x-r,n.y-r),t.lineTo(n.x-r+i,n.y-r),t.moveTo(n.x+r-i,n.y-r),t.lineTo(n.x+r,n.y-r),t.lineTo(n.x+r,n.y-r+i),t.moveTo(n.x-r,n.y+r-i),t.lineTo(n.x-r,n.y+r),t.lineTo(n.x-r+i,n.y+r),t.moveTo(n.x+r-i,n.y+r),t.lineTo(n.x+r,n.y+r),t.lineTo(n.x+r,n.y+r-i),t.stroke(),t.beginPath(),t.arc(n.x,n.y,n.ringR,0,Math.PI*2),t.strokeStyle=`rgba(26, 255, 64, ${(n.life*.3).toFixed(3)})`,t.lineWidth=1,t.stroke()}}a=requestAnimationFrame(g)}},v=()=>{document.hidden&&a?(cancelAnimationFrame(a),a=0):!document.hidden&&!a&&r&&(a=requestAnimationFrame(g))};return document.addEventListener(`visibilitychange`,v),a=requestAnimationFrame(g),()=>{r=!1,a&&cancelAnimationFrame(a),document.removeEventListener(`visibilitychange`,v),window.removeEventListener(`resize`,l),window.removeEventListener(`pointerdown`,p)}},[_]),(0,a.useEffect)(()=>{if(!_||n()||typeof window>`u`||window.matchMedia?.(`(pointer: coarse)`).matches)return;let e=0,t=null,i=new Set,a=()=>{e=0;let n=t;if(!n)return;let r=n.clientX,a=n.clientY,o=window.innerHeight,s=document.querySelectorAll(`.bg-\\[\\#13131e\\].rounded-2xl`);for(let e=0;e<s.length;e++){let t=s[e],n=t.getBoundingClientRect();if(n.bottom<-300||n.top>o+300||n.width===0){i.has(t)&&(t.style.setProperty(`--tb-prox`,`0`),i.delete(t));continue}let c=r<n.left?n.left-r:r>n.right?r-n.right:0,l=a<n.top?n.top-a:a>n.bottom?a-n.bottom:0,u=Math.hypot(c,l);if(u<300){let e=Math.max(0,Math.min(1,1-u/300));t.style.setProperty(`--tb-x`,`${(r-n.left).toFixed(1)}px`),t.style.setProperty(`--tb-y`,`${(a-n.top).toFixed(1)}px`),t.style.setProperty(`--tb-prox`,e.toFixed(3)),i.add(t)}else i.has(t)&&(t.style.setProperty(`--tb-prox`,`0`),i.delete(t))}},o=n=>{t=n,e||=requestAnimationFrame(a)},s=()=>{for(let e of i)e.style.setProperty(`--tb-prox`,`0`);i.clear()},c=e=>{let t=e.target?.closest?.(`.bg-\\[\\#13131e\\].rounded-2xl`);t&&r.fromTo(t,{"--tb-pulse":1},{"--tb-pulse":0,duration:.48,ease:`power2.out`,overwrite:`auto`})};return window.addEventListener(`pointermove`,o,{passive:!0}),document.addEventListener(`mouseleave`,s,{passive:!0}),window.addEventListener(`pointerdown`,c,{passive:!0}),()=>{e&&cancelAnimationFrame(e),window.removeEventListener(`pointermove`,o),document.removeEventListener(`mouseleave`,s),window.removeEventListener(`pointerdown`,c);for(let e of i)e.style.removeProperty(`--tb-x`),e.style.removeProperty(`--tb-y`),e.style.removeProperty(`--tb-prox`),e.style.removeProperty(`--tb-pulse`);i.clear()}},[_]),(0,a.useEffect)(()=>{if(!_||n())return;let e=sessionStorage.getItem(d)===`1`,t=sessionStorage.getItem(f)===`1`;if(!e||!t)return;let i=p.current,a=m.current;if(!i||!a)return;let o=r.context(()=>{let e=r.timeline({onComplete:()=>{sessionStorage.removeItem(f)}});e.fromTo(a,{opacity:.26},{opacity:0,duration:.46,ease:`power2.out`},0),e.fromTo(i,{top:`-10%`,opacity:.95},{top:`108%`,opacity:0,duration:.68,ease:`power2.inOut`},0);let t=window.innerHeight,n=Array.from(document.querySelectorAll(`.bg-\\[\\#13131e\\].rounded-2xl`)).filter(e=>{let n=e.getBoundingClientRect();return n.width>0&&n.bottom>0&&n.top<t});n.length>0&&r.fromTo(n,{filter:`brightness(2.5)`,scaleY:.95,opacity:.5},{filter:`brightness(1)`,scaleY:1,opacity:1,duration:.44,stagger:.04,ease:`power3.out`,overwrite:`auto`,clearProps:`transform,opacity,filter`})});return()=>o.revert()},[_,e]),_?(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)(`div`,{"aria-hidden":`true`,className:`crt-stage-frame fixed pointer-events-none overflow-hidden z-0`,style:{backgroundColor:`#020a02`},children:(0,o.jsx)(`canvas`,{ref:t,className:`block w-full h-full`})}),(0,o.jsx)(`div`,{"aria-hidden":`true`,className:`crt-stage-frame fixed pointer-events-none overflow-hidden z-[9990]`,children:(0,o.jsx)(`canvas`,{ref:i,className:`block w-full h-full`})}),(0,o.jsxs)(`div`,{"aria-hidden":`true`,className:`crt-stage-frame fixed pointer-events-none overflow-hidden z-[9995]`,children:[(0,o.jsx)(`div`,{ref:m,className:`absolute inset-0 opacity-0`,style:{background:`radial-gradient(circle at 50% 50%, rgba(26,255,64,0.45), rgba(26,255,64,0.12) 60%, transparent 90%)`}}),(0,o.jsx)(`div`,{ref:p,className:`absolute left-0 right-0 top-0 h-16 opacity-0`,style:{background:`linear-gradient(180deg, transparent 0%, rgba(26,255,64,0.35) 55%, rgba(200,255,210,0.92) 78%, transparent 100%)`,boxShadow:`0 0 28px rgba(26,255,64,0.65)`}})]})]}):null}export{p as default};