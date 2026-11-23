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
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

  float t = uTime * 0.24;
  float surge = clamp(uVel, 0.0, 1.8);

  // Domain-warped flowing silk aurora field
  vec2 warpA = vec2(
    fbm(p * 1.45 + vec2(t * 0.45, -t * 0.28)),
    fbm(p * 1.45 + vec2(-t * 0.32 + 4.2, t * 0.36 + 1.9))
  );
  vec2 warpB = vec2(
    fbm(p * 2.1 + warpA * 1.15 + vec2(-t * 0.25, t * 0.4)),
    fbm(p * 2.1 + warpA * 1.15 + vec2(t * 0.35 + 7.1, -t * 0.22 + 3.4))
  );
  float silk = fbm(p * 1.9 + warpB * 0.95);

  // Diagonal volumetric light beams (React Bits Beams feel)
  float diag1 = p.x * 0.72 + p.y * 0.69;
  float diag2 = p.x * 0.56 - p.y * 0.82;
  float s1 = sin(diag1 * 3.1 - t * 1.45 + warpA.x * 2.1);
  float s2 = sin(diag1 * 2.0 + t * 0.95 + warpB.y * 2.5 + 1.4);
  float s3 = sin(diag2 * 2.4 - t * 0.8 + silk * 2.8 + 0.6);
  float beam1 = exp(-(s1 * s1) * 5.2);
  float beam2 = exp(-(s2 * s2) * 4.4);
  float beam3 = exp(-(s3 * s3) * 6.0);

  // Pointer-reactive gravitational plasma bloom
  float md = length(p - m);
  float orb = exp(-md * md * 3.4) * (0.42 + surge * 0.14);
  float rd = md - 0.24 - sin(uTime * 1.6) * 0.025;
  float orbRing = exp(-(rd * rd) * 95.0) * 0.20;

  // Deep obsidian void base
  vec3 col = vec3(0.020, 0.016, 0.052);

  // Chromatic kinetic palette
  vec3 violet  = vec3(0.49, 0.23, 0.93);
  vec3 magenta = vec3(1.00, 0.18, 0.59);
  vec3 cyan    = vec3(0.00, 0.94, 1.00);
  vec3 gold    = vec3(1.00, 0.72, 0.12);

  // Layer ambient aurora ribbons
  col += violet  * smoothstep(0.28, 0.86, silk) * 0.22;
  col += magenta * smoothstep(0.38, 0.92, warpB.x) * 0.16;
  col += cyan    * smoothstep(0.42, 0.92, warpB.y) * 0.15;

  // Layer kinetic diagonal beams (intensify slightly with scroll momentum)
  float energy = 1.0 + surge * 0.35;
  col += mix(violet, magenta, clamp(warpA.x, 0.0, 1.0)) * beam1 * 0.24 * energy;
  col += mix(cyan, violet, clamp(warpB.y, 0.0, 1.0))    * beam2 * 0.20 * energy;
  col += mix(magenta, gold, 0.45) * beam3 * beam1 * 0.26 * energy;

  // Interactive cursor plasma orb + harmonic ring
  vec3 orbTint = mix(cyan, magenta, 0.5 + 0.5 * sin(uTime * 0.9 + md * 4.0));
  col += orbTint * orb * 0.32;
  col += mix(violet, cyan, 0.6) * orbRing;

  // Subtle architectural precision dot matrix etched in the dark void
  vec2 gridUv = fract(gl_FragCoord.xy / 42.0) - 0.5;
  float dotDist = length(gridUv);
  float dotMask = smoothstep(0.055, 0.015, dotDist);
  float dotBoost = 0.035 + exp(-md * md * 7.0) * 0.16;
  col += mix(violet, cyan, 0.55) * dotMask * dotBoost;

  // Soft vignette to keep center & edges richly grounded
  float vig = 1.0 - smoothstep(0.42, 1.38, length(p * vec2(0.82, 1.0)));
  col *= mix(0.68, 1.06, vig);

  // Subtle triangular dithering to eliminate dark gradient banding
  float d = (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  outColor = vec4(clamp(col + d, 0.0, 1.0), 1.0);
}`;function l(e,t,n){let r=e.createShader(t);return r?(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)?r:(e.deleteShader(r),null)):null}var u=[`#00f0ff`,`#ff2e97`,`#a855f7`,`#fbbf24`,`#38bdf8`,`#f472b6`],d=`sd-kinetic-ignited`,f=`sd-kinetic-switched`;function p({theme:e}){let t=(0,a.useRef)(null),i=(0,a.useRef)(null),p=(0,a.useRef)(null),m=(0,a.useRef)(null),h=(0,a.useRef)(null),g=(0,a.useRef)({x:.5,y:.5,tx:.5,ty:.5,px:-999,py:-999}),_=(0,a.useRef)({current:0,target:0}),v=e===`kinetic`;return(0,a.useEffect)(()=>{if(!v)return;let e=t.current;if(!e)return;let r=n(),i=!0,a=0,o=performance.now(),u=e=>{let t=Math.max(1,window.innerWidth),n=Math.max(1,window.innerHeight);g.current.tx=e.clientX/t,g.current.ty=1-e.clientY/n,g.current.px=e.clientX,g.current.py=e.clientY},d=e=>{let t=Math.min(1.8,Math.abs(Number(e.detail)||0));t>_.current.target&&(_.current.target=t)};window.addEventListener(`pointermove`,u,{passive:!0}),window.addEventListener(`sd-scroll-velocity`,d);let f=e.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:`low-power`}),p=null,m=null;if(f){let t=l(f,f.VERTEX_SHADER,s),n=l(f,f.FRAGMENT_SHADER,c),a=t&&n?f.createProgram():null;if(a)if(f.attachShader(a,t),f.attachShader(a,n),f.bindAttribLocation(a,0,`aPos`),f.linkProgram(a),f.deleteShader(t),f.deleteShader(n),f.getProgramParameter(a,f.LINK_STATUS)){f.useProgram(a);let t=f.createBuffer();f.bindBuffer(f.ARRAY_BUFFER,t),f.bufferData(f.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),f.STATIC_DRAW),f.enableVertexAttribArray(0),f.vertexAttribPointer(0,2,f.FLOAT,!1,0,0);let n=f.getUniformLocation(a,`uRes`),s=f.getUniformLocation(a,`uTime`),c=f.getUniformLocation(a,`uMouse`),l=f.getUniformLocation(a,`uVel`),u=()=>{let t=Math.min(window.devicePixelRatio||1,1.5),n=Math.max(1,Math.floor(window.innerWidth*t)),r=Math.max(1,Math.floor(window.innerHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r)};u(),window.addEventListener(`resize`,u,{passive:!0});let d=e=>{e.preventDefault(),i=!1};e.addEventListener(`webglcontextlost`,d),m=t=>{let i=g.current;i.x+=(i.tx-i.x)*.06,i.y+=(i.ty-i.y)*.06,_.current.current+=(_.current.target-_.current.current)*.12,_.current.target*=.88,f.viewport(0,0,e.width,e.height),f.uniform2f(n,e.width,e.height),f.uniform1f(s,r?4.2:(t-o)/1e3),f.uniform2f(c,i.x,i.y),f.uniform1f(l,_.current.current),f.drawArrays(f.TRIANGLE_STRIP,0,4)},p=()=>{window.removeEventListener(`resize`,u),e.removeEventListener(`webglcontextlost`,d),f.deleteBuffer(t),f.deleteProgram(a)}}else f.deleteProgram(a)}if(!m){let t=e.getContext(`2d`);if(t){let n=()=>{let n=Math.min(window.devicePixelRatio||1,1.5);e.width=Math.max(1,Math.floor(window.innerWidth*n)),e.height=Math.max(1,Math.floor(window.innerHeight*n)),t.setTransform(n,0,0,n,0,0)};n(),window.addEventListener(`resize`,n,{passive:!0}),p=()=>window.removeEventListener(`resize`,n),m=e=>{let n=window.innerWidth,i=window.innerHeight,a=r?2.5:(e-o)/1e3;t.fillStyle=`#05040d`,t.fillRect(0,0,n,i);let s=[{x:n*(.25+.16*Math.sin(a*.35)),y:i*(.3+.15*Math.cos(a*.28)),r:Math.max(n,i)*.48,c:`rgba(124,58,237,0.22)`},{x:n*(.75+.14*Math.cos(a*.31)),y:i*(.28+.18*Math.sin(a*.24)),r:Math.max(n,i)*.44,c:`rgba(255,46,151,0.18)`},{x:n*(.5+.2*Math.sin(a*.22+2)),y:i*(.78+.12*Math.cos(a*.33)),r:Math.max(n,i)*.46,c:`rgba(0,240,255,0.16)`}];t.globalCompositeOperation=`lighter`;for(let e of s){let r=t.createRadialGradient(e.x,e.y,0,e.x,e.y,e.r);r.addColorStop(0,e.c),r.addColorStop(1,`transparent`),t.fillStyle=r,t.fillRect(0,0,n,i)}t.globalCompositeOperation=`source-over`}}}let h=e=>{a=0,!(!i||!m)&&(document.hidden||m(e),r||(a=requestAnimationFrame(h)))},y=()=>{document.hidden&&a?(cancelAnimationFrame(a),a=0):!document.hidden&&!r&&!a&&i&&(a=requestAnimationFrame(h))};return document.addEventListener(`visibilitychange`,y),a=requestAnimationFrame(h),()=>{i=!1,a&&cancelAnimationFrame(a),document.removeEventListener(`visibilitychange`,y),window.removeEventListener(`pointermove`,u),window.removeEventListener(`sd-scroll-velocity`,d),p?.()}},[v]),(0,a.useEffect)(()=>{if(!v||n())return;let e=i.current;if(!e)return;let t=e.getContext(`2d`);if(!t)return;let r=!0,a=0,o=window.innerWidth,s=window.innerHeight,c=window.matchMedia?.(`(pointer: fine)`).matches,l=()=>{let n=Math.min(window.devicePixelRatio||1,2);o=window.innerWidth,s=window.innerHeight,e.width=Math.max(1,Math.floor(o*n)),e.height=Math.max(1,Math.floor(s*n)),t.setTransform(n,0,0,n,0,0)};l(),window.addEventListener(`resize`,l,{passive:!0});let d=Array.from({length:34},(e,t)=>({x:t*197.3%100/100*o,y:t*313.7%100/100*s,vx:Math.sin(t*1.9)*.22,vy:-(.14+t%5*.06),r:1.1+t%3*.65,color:u[t%u.length],phase:t*.7})),f=[],p=[],m=[],h=e=>{let t=e.clientX,n=e.clientY,r=Math.random()*Math.PI*2;for(let e=0;e<12;e++){let i=r+e/12*Math.PI*2+(Math.random()-.5)*.28,a=2.6+Math.random()*4.4;f.push({x:t,y:n,vx:Math.cos(i)*a,vy:Math.sin(i)*a,len:7+Math.random()*9,life:1,decay:.028+Math.random()*.018,color:u[(e+Math.floor(Math.random()*3))%u.length]})}p.push({x:t,y:n,r:4,maxR:48,life:1,color:u[Math.floor(Math.random()*3)]}),f.length>140&&f.splice(0,f.length-140)},_=-999,y=-999,b=e=>{if(!c)return;let t=e.clientX-_,n=e.clientY-y,r=Math.hypot(t,n);_=e.clientX,y=e.clientY,r>2&&(m.push({x:e.clientX,y:e.clientY,life:Math.min(1,.45+r/42)}),m.length>14&&m.shift())};window.addEventListener(`pointerdown`,h,{passive:!0}),window.addEventListener(`pointermove`,b,{passive:!0});let x=0,S=()=>{if(a=0,r){if(!document.hidden){x++,t.clearRect(0,0,o,s);let e=g.current.px,n=g.current.py;for(let r=0;r<d.length;r++){let i=d[r];if(i.x+=i.vx+Math.sin(x*.012+i.phase)*.14,i.y+=i.vy,e>-100){let t=i.x-e,r=i.y-n,a=Math.hypot(t,r);if(a<130&&a>1){let e=(1-a/130)*.42;i.x+=t/a*e,i.y+=r/a*e}}i.y<-12&&(i.y=s+12,i.x=(i.x+137)%o),i.x<-12&&(i.x=o+12),i.x>o+12&&(i.x=-12);let a=.18+.16*Math.sin(x*.03+i.phase);t.beginPath(),t.arc(i.x,i.y,i.r,0,Math.PI*2),t.fillStyle=i.color,t.globalAlpha=a,t.fill()}if(m.length>1){for(let e=m.length-1;e>=0;e--)m[e].life-=.075,m[e].life<=0&&m.splice(e,1);if(m.length>1){t.lineCap=`round`,t.lineJoin=`round`;for(let e=1;e<m.length;e++){let n=m[e-1],r=m[e],i=e/m.length;t.beginPath(),t.moveTo(n.x,n.y),t.lineTo(r.x,r.y),t.strokeStyle=e%2==0?`#00f0ff`:`#ff2e97`,t.lineWidth=Math.max(.6,i*2.6),t.globalAlpha=Math.max(0,r.life*i*.42),t.stroke()}}}for(let e=p.length-1;e>=0;e--){let n=p[e];if(n.r+=(n.maxR-n.r)*.18,n.life-=.048,n.life<=0){p.splice(e,1);continue}t.beginPath(),t.arc(n.x,n.y,n.r,0,Math.PI*2),t.strokeStyle=n.color,t.lineWidth=1.6*n.life,t.globalAlpha=n.life*.65,t.stroke()}t.lineCap=`round`;for(let e=f.length-1;e>=0;e--){let n=f[e];if(n.x+=n.vx,n.y+=n.vy,n.vx*=.91,n.vy*=.91,n.life-=n.decay,n.life<=0){f.splice(e,1);continue}let r=Math.hypot(n.vx,n.vy)||1,i=n.vx/r,a=n.vy/r,o=n.len*n.life;t.beginPath(),t.moveTo(n.x,n.y),t.lineTo(n.x-i*o,n.y-a*o),t.strokeStyle=n.color,t.lineWidth=1.9*n.life,t.globalAlpha=Math.min(1,n.life*1.1),t.stroke()}t.globalAlpha=1}a=requestAnimationFrame(S)}},C=()=>{document.hidden&&a?(cancelAnimationFrame(a),a=0):!document.hidden&&!a&&r&&(a=requestAnimationFrame(S))};return document.addEventListener(`visibilitychange`,C),a=requestAnimationFrame(S),()=>{r=!1,a&&cancelAnimationFrame(a),document.removeEventListener(`visibilitychange`,C),window.removeEventListener(`resize`,l),window.removeEventListener(`pointerdown`,h),window.removeEventListener(`pointermove`,b)}},[v]),(0,a.useEffect)(()=>{if(!v||n()||typeof window>`u`||window.matchMedia?.(`(pointer: coarse)`).matches)return;let e=0,t=null,i=null,a=new Set,o=(e,t=!1)=>{e&&r.to(e,{rotateX:0,rotateY:0,y:0,scale:1,duration:t?.16:.62,ease:t?`power2.out`:`elastic.out(1, 0.55)`,overwrite:`auto`,clearProps:`transform,transformPerspective`})},s=e=>{let t=document.activeElement;return!!(t&&e.contains(t)&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||e.querySelector(`[data-lenis-prevent]`))},c=()=>{e=0;let n=t;if(!n)return;let c=n.clientX,l=n.clientY,u=window.innerHeight,d=document.querySelectorAll(`.bg-\\[\\#13131e\\].rounded-2xl`),f=null;for(let e=0;e<d.length;e++){let t=d[e],n=t.getBoundingClientRect();if(n.bottom<-320||n.top>u+320||n.width===0){a.has(t)&&(t.style.setProperty(`--kb-prox`,`0`),a.delete(t));continue}let r=c<n.left?n.left-c:c>n.right?c-n.right:0,i=l<n.top?n.top-l:l>n.bottom?l-n.bottom:0,o=Math.hypot(r,i);if(o<320){let e=Math.max(0,Math.min(1,1-o/320));t.style.setProperty(`--kb-x`,`${(c-n.left).toFixed(1)}px`),t.style.setProperty(`--kb-y`,`${(l-n.top).toFixed(1)}px`),t.style.setProperty(`--kb-prox`,e.toFixed(3)),a.add(t),o===0&&t.classList.contains(`card-lift`)&&!t.closest(`[data-tilted-card]`)&&(f={card:t,rect:n})}else a.has(t)&&(t.style.setProperty(`--kb-prox`,`0`),a.delete(t))}let p=f?.card||null;if(i&&i!==p&&(o(i),i=null),f&&!s(f.card)){let{card:e,rect:t}=f;i=e;let n=(c-t.left)/Math.max(1,t.width)-.5,a=(l-t.top)/Math.max(1,t.height)-.5,o=t.width>540,s=o?1.5:4.2;r.to(e,{rotateX:-a*s*2,rotateY:n*s*2,y:o?-3:-5,scale:o?1.004:1.014,transformPerspective:920,duration:.32,ease:`power3.out`,overwrite:`auto`})}else i&&s(i)&&(o(i,!0),i=null)},l=n=>{t=n,e||=requestAnimationFrame(c)},u=()=>{i&&=(o(i),null);for(let e of a)e.style.setProperty(`--kb-prox`,`0`);a.clear()},d=e=>{let t=e.target?.closest?.(`.bg-\\[\\#13131e\\].rounded-2xl`);if(!t)return;let n=t.getBoundingClientRect();t.style.setProperty(`--kb-x`,`${(e.clientX-n.left).toFixed(1)}px`),t.style.setProperty(`--kb-y`,`${(e.clientY-n.top).toFixed(1)}px`),r.fromTo(t,{"--kb-pulse":1},{"--kb-pulse":0,duration:.65,ease:`power3.out`,overwrite:`auto`})};return window.addEventListener(`pointermove`,l,{passive:!0}),document.addEventListener(`mouseleave`,u,{passive:!0}),window.addEventListener(`pointerdown`,d,{passive:!0}),()=>{e&&cancelAnimationFrame(e),window.removeEventListener(`pointermove`,l),document.removeEventListener(`mouseleave`,u),window.removeEventListener(`pointerdown`,d),i&&(r.killTweensOf(i),r.set(i,{clearProps:`transform,transformPerspective`}));for(let e of a)e.style.removeProperty(`--kb-x`),e.style.removeProperty(`--kb-y`),e.style.removeProperty(`--kb-prox`),e.style.removeProperty(`--kb-pulse`);a.clear()}},[v]),(0,a.useEffect)(()=>{if(!v||n())return;let e=sessionStorage.getItem(f)===`1`,t=sessionStorage.getItem(d)===`1`;if(!e&&t)return;let i=p.current,a=m.current,o=h.current;if(!i||!a||!o)return;let s=r.context(()=>{let t=r.timeline({onComplete:()=>{sessionStorage.setItem(d,`1`),sessionStorage.removeItem(f)}});if(t.fromTo(o,{opacity:.28},{opacity:0,duration:.72,ease:`expo.out`},0),t.fromTo(i,{scale:.12,opacity:.92},{scale:2.35,opacity:0,duration:.88,ease:`expo.out`},0),t.fromTo(a,{scale:.08,opacity:.85},{scale:1.85,opacity:0,duration:.76,ease:`power4.out`},.07),e){let e=window.innerHeight,t=Array.from(document.querySelectorAll(`.bg-\\[\\#13131e\\].rounded-2xl`)).filter(t=>{let n=t.getBoundingClientRect();return n.width>0&&n.bottom>0&&n.top<e});t.length>0&&r.fromTo(t,{y:18,scale:.96,opacity:.45},{y:0,scale:1,opacity:1,duration:.56,stagger:.04,ease:`back.out(1.45)`,overwrite:`auto`,clearProps:`transform,opacity`})}});return()=>s.revert()},[v,e]),v?(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)(`canvas`,{ref:t,"aria-hidden":`true`,className:`fixed inset-0 w-full h-full pointer-events-none z-0`}),(0,o.jsx)(`canvas`,{ref:i,"aria-hidden":`true`,className:`fixed inset-0 w-full h-full pointer-events-none z-[9990]`}),(0,o.jsxs)(`div`,{"aria-hidden":`true`,className:`fixed inset-0 pointer-events-none z-[9995] overflow-hidden flex items-center justify-center`,children:[(0,o.jsx)(`div`,{ref:h,className:`absolute inset-0 opacity-0`,style:{background:`radial-gradient(circle at 50% 50%, rgba(0,240,255,0.42), rgba(255,46,151,0.28) 38%, rgba(124,58,237,0.16) 65%, transparent 85%)`}}),(0,o.jsx)(`div`,{ref:p,className:`w-[64vmin] h-[64vmin] rounded-full opacity-0`,style:{border:`2px solid rgba(0, 240, 255, 0.8)`,boxShadow:`0 0 36px rgba(0, 240, 255, 0.55), inset 0 0 28px rgba(255, 46, 151, 0.45)`}}),(0,o.jsx)(`div`,{ref:m,className:`absolute w-[48vmin] h-[48vmin] rounded-full opacity-0`,style:{border:`2px solid rgba(255, 46, 151, 0.85)`,boxShadow:`0 0 28px rgba(124, 58, 237, 0.6)`}})]})]}):null}export{p as default};