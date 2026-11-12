# Cookiess visual direction

A precise instrument for site cookies, quiet enough to scan hundreds of records.

**Palette.** Cool porcelain background (#eef1f5) with white sheets, cobalt ink (#2f4bb3) for every action and focus, and dough amber (#e2a33a) reserved for two things only: the brand cookie mark and the bar that marks selected rows. Danger red (#b4322e) only for removal and errors. Dark theme is a blue-slate night (#171c27 / #1f2533) with a lighter cobalt (#8ea2f2); it is not a near-black. Flag chips carry meaning by colour: Secure cobalt, HttpOnly amber, Partitioned violet, session outlined.

**Type.** Onest (SIL OFL, Cyrillic + Latin subsets packaged in `src/fonts`, no network) for the whole UI; system monospace only for cookie values, decoded text and file contents. Host heading 23/700 with the registrable domain in ink and the subdomain in a faint tone, because access is granted for the registrable domain.

**Layout.** 460×590 popup. White header (brand row, then a slim Back/Refresh row above the host). The list is one continuous white sheet, not cards: name and flag chips, value, then domain+path with the remaining lifetime right-aligned. Fixed footer: quiet Import/Export, filled cobalt Add, red Remove. Panels (editor, import, export, remove) replace the list area and keep the header and footer.

**Principles.** One bold element (the host heading); everything else stays disciplined. No all-caps labels, no decorative gradients or shadows. The only motion is the status line appearing in answer to an action; reduced motion disables it. Visible keyboard focus everywhere; no colour transitions, so theme switches never flash.
