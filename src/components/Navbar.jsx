import React, { useState } from "react";

export default function Navbar({ items = [], activeKey, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <div className="brand">Universal Scanner</div>

        <button
          className="nav-toggle"
          aria-expanded={open ? "true" : "false"}
          aria-controls="nav-list"
          onClick={() => setOpen((v) => !v)}
        >
          ☰
        </button>

        <ul
          id="nav-list"
          className={`nav-list ${open ? "open" : ""}`}
        >
          {items.map((it) => (
            <li key={it.key}>
              <button
                className={`nav-link ${activeKey === it.key ? "active" : ""}`}
                onClick={() => {
                  onChange(it.key);
                  setOpen(false);
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
