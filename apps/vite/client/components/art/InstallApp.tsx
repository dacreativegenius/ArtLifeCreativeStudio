import { useEffect, useState } from "react";
import { MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { ArtLifeLogo } from "./ArtLifeLogo";
import { canOfferInstall, hasInstallPrompt, isAndroid, isIOS, onInstallChange, promptInstall } from "../../lib/art/pwa";

/** “Install” button for the browser version: Chrome/Android gets the native prompt, iPhone gets step-by-step help. */
export function InstallApp() {
  const [visible, setVisible] = useState(canOfferInstall);
  const [, force] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => onInstallChange(() => {
    force((n) => n + 1);
    setVisible(canOfferInstall());
  }), []);

  if (!visible) return null;

  const onClick = async () => {
    if (hasInstallPrompt() && (await promptInstall())) return;
    setHelpOpen(true);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Install Art Life on this device"
        onClick={onClick}
        className="inline-flex h-7 items-center gap-ds-xs rounded-md bg-primary px-ds-sm text-label text-primary-foreground hover:opacity-90" data-oid="95deaace25">
        <Smartphone className="h-3.5 w-3.5" data-oid="5fb64c5123" />
        <span className="hidden md:inline" data-oid="215c098705">Install app</span>
      </button>

      {helpOpen &&
      <div className="fixed inset-0 z-[100] flex items-end justify-center bg-background/70 p-ds-md pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:items-center" role="dialog" aria-modal="true" aria-labelledby="install-title" data-oid="05c4e1c78f">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-ds-xl shadow-2xl" data-oid="30c4b50757" data-oid-text-editable="false" data-oid-text-source="element:div|expression:f83554cccff5|expression:16bc1385a65c|element:button">
            <div className="flex items-start gap-ds-md" data-oid="6f7e440676">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground" data-oid="1db2eb8c4d">
                <ArtLifeLogo className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1" data-oid="d2030a4b82">
                <h2 id="install-title" className="type-heading text-foreground" data-oid="bcd7c59de1">Install Art Life Creative Studio</h2>
                <p className="mt-ds-xs type-body text-muted-foreground" data-oid="72a0149d15">Add it to your home screen. It opens full screen like a regular app and keeps working offline.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setHelpOpen(false)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="36fbfbc08e">
                <X className="h-4 w-4" data-oid="17739f2d77" />
              </button>
            </div>

            {isIOS ?
          <ol className="mt-ds-lg space-y-ds-md" data-oid="6e57eedaac">
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="b9bc0657d9">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-accent" data-oid="fd5c4ace40"><Share className="h-4 w-4" data-oid="1d7c9a3eb5" /></span>
                  Tap the Share button in Safari's toolbar
                </li>
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="0670bb7671">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-accent" data-oid="dbc3988bdb"><PlusSquare className="h-4 w-4" data-oid="fc544ea846" /></span>
                  Scroll down and tap Add to Home Screen
                </li>
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="7870965b8d">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary type-label text-accent" data-oid="29d17b06fd">Add</span>
                  Tap Add in the top-right corner
                </li>
              </ol> :

          <ol className="mt-ds-lg space-y-ds-md" data-oid="5ca5beaf93">
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="694c9f7781" data-oid-text-editable="false" data-oid-text-source="element:span|expression:4597dc48900f">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-accent" data-oid="ece0a72f59"><MoreVertical className="h-4 w-4" data-oid="69d8a54907" /></span>
                  {isAndroid ? "Tap the ⋮ menu in Chrome (top right)" : "Open your browser's menu (⋮ or …)"}
                </li>
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="38b7eeeeff">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-accent" data-oid="ac9d725b1b"><PlusSquare className="h-4 w-4" data-oid="9ff54708f3" /></span>
                  Tap Install app or Add to Home screen
                </li>
                <li className="flex items-center gap-ds-md type-body text-foreground" data-oid="7be1b512dc">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary type-label text-accent" data-oid="35fcc18b33">OK</span>
                  Confirm with Install
                </li>
              </ol>
          }

            {isIOS &&
          <p className="mt-ds-lg type-caption text-muted-foreground" data-oid="eeab943655">USE SAFARI ON IPHONE / IPAD · SAVED FILES GO TO THE FILES APP</p>
          }
            <button type="button" onClick={() => setHelpOpen(false)} className="ds-button ds-button-primary mt-ds-xl w-full" data-oid="89888ed363">
              Got it
            </button>
          </div>
        </div>
      }
    </>);

}