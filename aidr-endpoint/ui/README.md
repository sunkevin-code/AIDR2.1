# AIDR Endpoint UI

`index.html` is the single production UI source. `runtime-adapter.js` binds the shared layout to the Endpoint API and is embedded by `build-endpoint.js` when the EXE is built.

Do not edit a second copy under `demo/`. The demo file is synchronized from this directory for visual review. The build rejects missing page markers and common mojibake markers before producing an EXE.

Release flow:

1. Edit `index.html` and `runtime-adapter.js`.
2. Run `node aidr-endpoint/build-endpoint.js`.
3. Stop the Windows service before replacing the installed EXE.
4. Install/start the new EXE and verify `/health` plus all seven `?view=` routes.
