(function(){"use strict";const l={WIDGET_URL:"https://agentbridge-ai-seven.vercel.app",BOOTSTRAP_URL:"https://whimsical-frog-463.convex.site/widget/bootstrap",DEFAULT_ORG_ID:"org_3L56300Ir3DhbH165p8PPdxt0XA",DEFAULT_POSITION:"bottom-right"},R=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
</svg>`,M=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`,d="AgentBridge Widget:",B="agentbridge-widget-button",S="agentbridge-widget-container",k=["bottom-right","bottom-left"],C=/^[A-Za-z0-9_-]{1,128}$/,G=300;(function(){const z=window.AgentBridgeWidget;if(z&&typeof z.init=="function"){console.warn(`${d} script included more than once; keeping the first instance.`);return}let w=null,e=null,o=null,s=!1,y,T,m=!1,g=0,c=null,u=l.DEFAULT_POSITION;const I=typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;function U(t){return typeof t=="string"&&k.includes(t)}function N(t){return typeof t=="string"&&C.test(t)}function W(){return new URL(l.WIDGET_URL).origin}function j(t,n){const r=new URLSearchParams;r.append("organizationId",t);const a=new URLSearchParams({installToken:n});return`${l.WIDGET_URL}?${r.toString()}#${a.toString()}`}function b(){return e!==null&&o!==null}function v(){window.clearTimeout(y),window.clearTimeout(T),y=void 0,T=void 0}async function F(){const t=++g,n=c,r=u==="bottom-right"?"right: 20px;":"left: 20px;",a=I?"none":"all 0.2s ease",p=I?"none":"all 0.3s ease",i=document.createElement("button"),h=document.createElement("div"),f=document.createElement("iframe");try{i.id=B,i.type="button",i.setAttribute("aria-label","Open support chat"),i.setAttribute("aria-expanded","false"),i.setAttribute("aria-controls",S),i.innerHTML=R,i.style.cssText=`
        position: fixed;
        ${r}
        bottom: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: #3b82f6;
        color: white;
        border: none;
        cursor: pointer;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 24px rgba(59, 130, 246, 0.35);
        transition: ${a};
      `,i.addEventListener("click",H),i.addEventListener("mouseenter",()=>{i.style.transform="scale(1.05)"}),i.addEventListener("mouseleave",()=>{i.style.transform="scale(1)"}),h.id=S,h.style.cssText=`
        position: fixed;
        ${r}
        bottom: 90px;
        width: 400px;
        height: 600px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 110px);
        z-index: 999998;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        display: none;
        opacity: 0;
        transform: translateY(10px);
        transition: ${p};
      `,f.title="Support chat",l.BOOTSTRAP_URL;const x=new URL(l.BOOTSTRAP_URL);x.searchParams.set("organizationId",n);const _=await fetch(x.toString(),{method:"GET",mode:"cors",credentials:"omit",cache:"no-store"});if(!_.ok)throw new Error(await _.text());const P=await _.json();if(!P.token)throw new Error("Widget authorization response was invalid.");if(t!==g)return;f.src=j(n,P.token),f.style.cssText=`
        width: 100%;
        height: 100%;
        border: none;
      `,f.allow="microphone; clipboard-read; clipboard-write",h.appendChild(f),document.body.appendChild(i),document.body.appendChild(h)}catch(x){i.remove(),h.remove(),t===g&&console.error(`${d} could not load the authorized widget.`,x);return}t===g&&(o=i,e=h,w=f,m||(window.addEventListener("message",$),m=!0))}function $(t){if(!w||t.source!==w.contentWindow||t.origin!==W())return;const n=t.data;if(!n||typeof n!="object")return;const{type:r,payload:a}=n;switch(r){case"close":L();break;case"resize":e&&a&&typeof a.height=="number"&&a.height>0&&(e.style.height=`${a.height}px`);break}}function H(){s?L():O()}function O(){if(!e||!o){console.warn(`${d} show() called before init().`);return}s||(s=!0,v(),e.style.display="block",T=window.setTimeout(()=>{e&&s&&(e.style.opacity="1",e.style.transform="translateY(0)")},10),o.innerHTML=M,o.setAttribute("aria-expanded","true"),o.setAttribute("aria-label","Close support chat"))}function L(){if(!e||!o){console.warn(`${d} hide() called before init().`);return}s&&(s=!1,v(),e.style.opacity="0",e.style.transform="translateY(10px)",y=window.setTimeout(()=>{e&&!s&&(e.style.display="none")},I?0:G),o.innerHTML=R,o.setAttribute("aria-expanded","false"),o.setAttribute("aria-label","Open support chat"))}function A(){g+=1,v(),m&&(window.removeEventListener("message",$),m=!1),e==null||e.remove(),o==null||o.remove(),e=null,w=null,o=null,s=!1}function D(t){const n=(t==null?void 0:t.organizationId)??c??l.DEFAULT_ORG_ID,r=(t==null?void 0:t.position)??u;if(!N(n))return console.error(`${d} a valid organization ID is required (letters, numbers, "_" or "-"; max 128 characters).`),!1;if(!U(r))return console.error(`${d} unsupported position "${String(r)}". Use one of: ${k.join(", ")}.`),!1;if(b()&&n===c&&r===u)return!0;const a=s;A(),c=n,u=r;try{const p=()=>{F().then(()=>{a&&b()&&O()})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{!b()&&c===n&&u===r&&p()},{once:!0}):p()}catch(p){return A(),console.error(`${d} failed to initialise.`,p),!1}return!0}function Y(){return{initialized:b(),open:s,organizationId:c,position:u}}window.AgentBridgeWidget={init:D,show:O,hide:L,destroy:A,getState:Y};const E=document.currentScript??document.querySelector("script[data-organization-id]");if(E){const t=E.getAttribute("data-organization-id"),n=E.getAttribute("data-position");t&&D({organizationId:t,position:U(n)?n:void 0})}})()})();
