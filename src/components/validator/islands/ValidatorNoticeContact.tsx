/**
 * Operator contact line from runtime /config.json.
 */
import React, { useEffect, useState } from "react";
import { loadSharedRuntimeConfig } from "../../../lib/siteRuntimeConfig";
import { normalizeValidatorContact } from "../lib/validatorContact";

type ContactLink = { href: string; label: string };

export default function ValidatorNoticeContact(): React.ReactElement | null {
  const [contact, setContact] = useState<ContactLink | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSharedRuntimeConfig().then((config) => {
      if (cancelled) {
        return;
      }
      const normalized = normalizeValidatorContact(config.validatorContact);
      if (!normalized.ok) {
        return;
      }
      setContact({ href: normalized.href, label: normalized.label });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (contact === null) {
    return null;
  }

  return (
    <a
      className="text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
      href={contact.href}
    >
      {contact.label}
    </a>
  );
}
