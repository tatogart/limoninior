export const interfaceMode=settings=>settings?.interfaceMode==='legacy'?'legacy':'modern';
export function applyInterfaceMode(root,settings,stylesheet){const mode=interfaceMode(settings);root.dataset.interface=mode;if(stylesheet)stylesheet.disabled=mode==='legacy';return mode;}
