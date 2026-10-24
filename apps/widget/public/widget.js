(()=>{var h={WIDGET_URL:"https://next15-echo-widget.vercel.app",DEFAULT_ORG_ID:"org_3L56300Ir3DhbH165p8PPdxt0XA",DEFAULT_POSITION:"bottom-right"};var L=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
</svg>`,D=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;var p="AgentBridge Widget:",N="agentbridge-widget-button",z="agentbridge-widget-container",P=["bottom-right","bottom-left"],R=/^[A-Za-z0-9_-]{1,128}$/,G=300;(function(){var k;let O=window.AgentBridgeWidget;if(O&&typeof O.init=="function"){console.warn(`${p} script included more than once; keeping the first instance.`);return}let g=null,e=null,o=null,s=!1,m,w,f=!1,c=null,u=h.DEFAULT_POSITION,b=typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;function A(t){return typeof t=="string"&&P.includes(t)}function S(t){return typeof t=="string"&&R.test(t)}function $(){return new URL(h.WIDGET_URL).origin}function W(t){let i=new URLSearchParams;return i.append("organizationId",t),`${h.WIDGET_URL}?${i.toString()}`}function x(){return e!==null&&o!==null}function y(){window.clearTimeout(m),window.clearTimeout(w),m=void 0,w=void 0}function C(){let t=c,i=u==="bottom-right"?"right: 20px;":"left: 20px;",a=b?"none":"all 0.2s ease",d=b?"none":"all 0.3s ease",n=document.createElement("button"),l=document.createElement("div"),r=document.createElement("iframe");try{n.id=N,n.type="button",n.setAttribute("aria-label","Open support chat"),n.setAttribute("aria-expanded","false"),n.setAttribute("aria-controls",z),n.innerHTML=L,n.style.cssText=`
        position: fixed;
        ${i}
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
      `,n.addEventListener("click",B),n.addEventListener("mouseenter",()=>{n.style.transform="scale(1.05)"}),n.addEventListener("mouseleave",()=>{n.style.transform="scale(1)"}),l.id=z,l.style.cssText=`
        position: fixed;
        ${i}
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
        transition: ${d};
      `,r.title="Support chat",r.src=W(t),r.style.cssText=`
        width: 100%;
        height: 100%;
        border: none;
      `,r.allow="microphone; clipboard-read; clipboard-write",l.appendChild(r),document.body.appendChild(n),document.body.appendChild(l)}catch(H){throw n.remove(),l.remove(),H}o=n,e=l,g=r,f||(window.addEventListener("message",_),f=!0)}function _(t){if(!g||t.source!==g.contentWindow||t.origin!==$())return;let i=t.data;if(!i||typeof i!="object")return;let{type:a,payload:d}=i;switch(a){case"close":T();break;case"resize":e&&d&&typeof d.height=="number"&&d.height>0&&(e.style.height=`${d.height}px`);break}}function B(){s?T():I()}function I(){if(!e||!o){console.warn(`${p} show() called before init().`);return}s||(s=!0,y(),e.style.display="block",w=window.setTimeout(()=>{e&&s&&(e.style.opacity="1",e.style.transform="translateY(0)")},10),o.innerHTML=D,o.setAttribute("aria-expanded","true"),o.setAttribute("aria-label","Close support chat"))}function T(){if(!e||!o){console.warn(`${p} hide() called before init().`);return}s&&(s=!1,y(),e.style.opacity="0",e.style.transform="translateY(10px)",m=window.setTimeout(()=>{e&&!s&&(e.style.display="none")},b?0:G),o.innerHTML=L,o.setAttribute("aria-expanded","false"),o.setAttribute("aria-label","Open support chat"))}function E(){y(),f&&(window.removeEventListener("message",_),f=!1),e==null||e.remove(),o==null||o.remove(),e=null,g=null,o=null,s=!1}function M(t){var n,l;let i=(n=t==null?void 0:t.organizationId)!=null?n:c,a=(l=t==null?void 0:t.position)!=null?l:u;if(!S(i))return console.error(`${p} a valid organization ID is required (letters, numbers, "_" or "-"; max 128 characters).`),!1;if(!A(a))return console.error(`${p} unsupported position "${String(a)}". Use one of: ${P.join(", ")}.`),!1;if(x()&&i===c&&a===u)return!0;let d=s;E(),c=i,u=a;try{let r=()=>{C(),d&&I()};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{!x()&&c===i&&u===a&&r()},{once:!0}):r()}catch(r){return E(),console.error(`${p} failed to initialise.`,r),!1}return!0}function U(){return{initialized:x(),open:s,organizationId:c,position:u}}window.AgentBridgeWidget={init:M,show:I,hide:T,destroy:E,getState:U};let v=(k=document.currentScript)!=null?k:document.querySelector("script[data-organization-id]");if(v){let t=v.getAttribute("data-organization-id"),i=v.getAttribute("data-position");t&&M({organizationId:t,position:A(i)?i:void 0})}})();})();
