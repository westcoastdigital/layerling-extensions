"use client";

import { useEffect, useState } from "react";
import { startExtensions } from "@/lib/extensions/host";
import "./extensions.css";

/** Mounted once in the layout: loads the extensions, and shows their messages where no editor is open to show them. */
export function ExtensionHost() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    void startExtensions();
    let timer = 0;
    const show = (event: Event) => {
      setMessage(String((event as CustomEvent<string>).detail ?? ""));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(""), 6000);
    };
    window.addEventListener("layerling-extension-error", show);
    return () => {
      window.removeEventListener("layerling-extension-error", show);
      window.clearTimeout(timer);
    };
  }, []);

  return message ? (
    <div className="extension-toast" role="status" onClick={() => setMessage("")}>
      {message}
    </div>
  ) : null;
}
