import React, { useState } from "react";

export default function Navbar({ items = [], activeKey, onChange }) {
  const [open, setOpen] = useState(false);

  function handleClick(key) {
    onChange?.(key);
    setOpen(false);
  }

  return (
    <nav className="navbar bg-base-100 border-b border-base-200">
      {/* Left: brand + mobile menu */}
      <div className="navbar-start">
        {/* Mobile dropdown */}
        <div className="dropdown sm:hidden">
          <button
            aria-label="Open menu"
            className="btn btn-ghost"
            aria-expanded={open ? "true" : "false"}
            aria-controls="primary-nav"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          {open && (
            <ul
              id="primary-nav"
              className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-56"
              role="menu"
            >
              {items.map((it) => (
                <li key={it.key} role="none">
                  <a
                    role="menuitem"
                    className={activeKey === it.key ? "active" : ""}
                    onClick={() => handleClick(it.key)}
                  >
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Brand */}
        <a className="btn btn-ghost text-lg font-bold normal-case" onClick={() => handleClick(items[0]?.key ?? "home")}>
          Universal Scanner
        </a>
      </div>

      {/* Center: desktop menu */}
      <div className="navbar-center hidden sm:flex">
        <ul className="menu menu-horizontal px-1">
          {items.map((it) => (
            <li key={it.key}>
              <a
                className={activeKey === it.key ? "active" : ""}
                onClick={() => handleClick(it.key)}
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: space for actions (optional) */}
      <div className="navbar-end gap-2">
        {/* Example placeholder:
        <button className="btn btn-outline btn-sm">Sign in</button>
        */}
      </div>
    </nav>
  );
}
