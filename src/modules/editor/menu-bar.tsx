"use client";

// The menu bar.
//
// It replaced a row of six two-line buttons that had no room for a seventh —
// and this editor keeps growing commands. A menu bar costs 34 px however many
// commands it holds, which is the whole reason every desktop editor has one.
//
// The grouping is the design: Export is a top-level menu rather than an item
// under File, because animation that survives the export is the thing this
// editor does that most of the field does not; and AI is top-level because
// running against a model on your own machine is the rarest thing it does. Both
// were buried in an earlier draft, which is exactly how a differentiator stops
// being one.

import { useCallback, useEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind: "separator" }
  | { kind: "heading"; label: string }
  | {
      kind: "command";
      label: string;
      hint?: string;
      /** Absent means the command exists but is not built yet; it shows as "soon". */
      run?: () => void;
      disabled?: boolean;
      /** Renders a tick, for the option currently in force. */
      checked?: boolean;
    };

export type Menu = { label: string; items: MenuItem[] };

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (open === null) return;
    const onDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // Capture, so a click on a canvas node closes the menu before that node
    // decides it was selected.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, index) => (
        <div className="menubar-item" key={menu.label}>
          <button
            aria-expanded={open === index}
            aria-haspopup="menu"
            onClick={() => setOpen(open === index ? null : index)}
            // Once one menu is open, moving along the bar opens the next, the
            // way a menu bar has behaved since 1984.
            onPointerEnter={() => setOpen((current) => (current === null ? current : index))}
            type="button"
          >
            {menu.label}
          </button>
          {open === index ? (
            <div className="menu-dropdown" role="menu">
              {menu.items.map((item, position) => {
                if (item.kind === "separator") return <hr key={`sep-${position}`} />;
                if (item.kind === "heading") return <b key={`head-${position}`}>{item.label}</b>;
                const unbuilt = !item.run;
                return (
                  <button
                    className={unbuilt ? "is-unbuilt" : ""}
                    disabled={item.disabled || unbuilt}
                    key={item.label}
                    onClick={() => {
                      close();
                      item.run?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>
                      {item.checked ? "✓ " : ""}
                      {item.label}
                    </span>
                    <u>{unbuilt ? "soon" : item.hint ?? ""}</u>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
