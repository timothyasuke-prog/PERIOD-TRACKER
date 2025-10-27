# Period Tracker - Frontend-only

This is a minimal frontend-only (static) period tracker that stores all data in localStorage.

Features implemented:

- Calendar UI to mark period days
- Mood and symptoms logging per day
- Privacy masking toggle
- PIN set/remove and local encryption of stored data (PBKDF2 + AES-GCM)
- Export logs as JSON or PDF (jsPDF)
- Anonymous feedback saved locally
- Admin panel (`admin.html`) with hardcoded username/password (admin/password123)
- Admin can view local "users" (localStorage keys), feedback, and basic charts
- Tips/quotes can be saved by admin; can be published globally by hosting `public-quotes.json` at your site root

How to run:

Open `index.html` in a browser. For admin features open `admin.html` and login with the hardcoded credentials.

Limitations and privacy:

- All data is stored locally in the browser. There is no server-side storage or authentication.
- To make quotes or announcements global across the web, host `public-quotes.json` / `public-announcements.json` on a public URL and the app will fetch it.

Encryption & PIN notes:

- Data encryption: the app uses PBKDF2 (100k iterations) to derive an AES-GCM key from your PIN. When you set a PIN the app encrypts your stored data (state + settings) and saves only the encrypted blob and a salt.
- PIN removal: to remove a PIN you must enter the current PIN. The app will decrypt the data and migrate it back to plaintext localStorage.
- Session key: after entering PIN to unlock, the decryption key is kept for the session so changes are re-encrypted on save.
- Recovery: if you forget your PIN, the encrypted data cannot be recovered. Make a local export (`Export JSON`) before setting a PIN if you want a backup.

Backup-before-lock:

- When you set a PIN the app will recommend exporting a JSON backup before encrypting. Use the prompt to create `period-data-backup.json` if you want a copy outside the encrypted storage.

UI notes:

- The PIN flow uses an in-page modal instead of browser prompts for a smoother experience.

Security note:

- The admin credentials are intentionally hardcoded for this demo and are not secure. Do not use sensitive data or expect production-level security.

Next steps you can ask me to implement:

- Improve calendar UI and cycle prediction visuals
- Background push notifications (requires a server)
- Additional local encryption hardening (salt storage, key stretching parameters)
- Better PDF export formatting
