(function(){"use strict";const f={WIDGET_URL:"https://agentbridge-8cnjq8j4h-banerjeesayantans-projects.vercel.app",BOOTSTRAP_URL:"https://whimsical-frog-463.convex.site/widget/bootstrap",DEFAULT_ORG_ID:"org_3L56300Ir3DhbH165p8PPdxt0XA",DEFAULT_POSITION:"bottom-right"},S=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
</svg>`,M=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`,d="AgentBridge Widget:",B="agentbridge-widget-button",k="agentbridge-widget-container",z=["bottom-right","bottom-left"],j=/^[A-Za-z0-9_-]{1,128}$/,C=300;(function(){const R=window.AgentBridgeWidget;if(R&&typeof R.init=="function"){console.warn(`${d} script included more than once; keeping the first instance.`);return}let w=null,e=null,i=null,s=!1,y,T,m=!1,g=0,l=null,c=f.DEFAULT_POSITION;const I=typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;function $(t){return typeof t=="string"&&z.includes(t)}function N(t){return typeof t=="string"&&j.test(t)}function W(){return new URL(f.WIDGET_URL).origin}function G(t,n){const r=new URLSearchParams;r.append("organizationId",t);const a=new URLSearchParams({installToken:n});return`${f.WIDGET_URL}?${r.toString()}#${a.toString()}`}function b(){return e!==null&&i!==null}function v(){window.clearTimeout(y),window.clearTimeout(T),y=void 0,T=void 0}async function H(){const t=++g,n=l,r=c==="bottom-right"?"right: 20px;":"left: 20px;",a=I?"none":"all 0.2s ease",u=I?"none":"all 0.3s ease",o=document.createElement("button"),p=document.createElement("div"),h=document.createElement("iframe");try{o.id=B,o.type="button",o.setAttribute("aria-label","Open support chat"),o.setAttribute("aria-expanded","false"),o.setAttribute("aria-controls",k),o.innerHTML=S,o.style.cssText=`
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
      `,o.addEventListener("click",F),o.addEventListener("mouseenter",()=>{o.style.transform="scale(1.05)"}),o.addEventListener("mouseleave",()=>{o.style.transform="scale(1)"}),p.id=k,p.style.cssText=`
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
        transition: ${u};
      `,h.title="Support chat",f.BOOTSTRAP_URL;const x=new URL(f.BOOTSTRAP_URL);x.searchParams.set("organizationId",n);const _=await fetch(x.toString(),{method:"GET",mode:"cors",credentials:"omit",cache:"no-store"});if(!_.ok)throw new Error(await _.text());const D=await _.json();if(!D.token)throw new Error("Widget authorization response was invalid.");if(t!==g)return;h.src=G(n,D.token),h.style.cssText=`
        width: 100%;
        height: 100%;
        border: none;
      `,h.allow="microphone; clipboard-read; clipboard-write",p.appendChild(h),document.body.appendChild(o),document.body.appendChild(p)}catch(x){o.remove(),p.remove(),t===g&&console.error(`${d} could not load the authorized widget.`,x);return}t===g&&(i=o,e=p,w=h,m||(window.addEventListener("message",U),m=!0))}function U(t){if(!w||t.source!==w.contentWindow||t.origin!==W())return;const n=t.data;if(!n||typeof n!="object")return;const{type:r,payload:a}=n;switch(r){case"close":L();break;case"resize":e&&a&&typeof a.height=="number"&&a.height>0&&(e.style.height=`${a.height}px`);break}}function F(){s?L():O()}function O(){if(!e||!i){console.warn(`${d} show() called before init().`);return}s||(s=!0,v(),e.style.display="block",T=window.setTimeout(()=>{e&&s&&(e.style.opacity="1",e.style.transform="translateY(0)")},10),i.innerHTML=M,i.setAttribute("aria-expanded","true"),i.setAttribute("aria-label","Close support chat"))}function L(){if(!e||!i){console.warn(`${d} hide() called before init().`);return}s&&(s=!1,v(),e.style.opacity="0",e.style.transform="translateY(10px)",y=window.setTimeout(()=>{e&&!s&&(e.style.display="none")},I?0:C),i.innerHTML=S,i.setAttribute("aria-expanded","false"),i.setAttribute("aria-label","Open support chat"))}function A(){g+=1,v(),m&&(window.removeEventListener("message",U),m=!1),e==null||e.remove(),i==null||i.remove(),e=null,w=null,i=null,s=!1}function P(t){const n=(t==null?void 0:t.organizationId)??l,r=(t==null?void 0:t.position)??c;if(!N(n))return console.error(`${d} a valid organization ID is required (letters, numbers, "_" or "-"; max 128 characters).`),!1;if(!$(r))return console.error(`${d} unsupported position "${String(r)}". Use one of: ${z.join(", ")}.`),!1;if(b()&&n===l&&r===c)return!0;const a=s;A(),l=n,c=r;try{const u=()=>{H().then(()=>{a&&b()&&O()})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{!b()&&l===n&&c===r&&u()},{once:!0}):u()}catch(u){return A(),console.error(`${d} failed to initialise.`,u),!1}return!0}function q(){return{initialized:b(),open:s,organizationId:l,position:c}}window.AgentBridgeWidget={init:P,show:O,hide:L,destroy:A,getState:q};const E=document.currentScript??document.querySelector("script[data-organization-id]");if(E){const t=E.getAttribute("data-organization-id"),n=E.getAttribute("data-position");t&&P({organizationId:t,position:$(n)?n:void 0})}})()})();
