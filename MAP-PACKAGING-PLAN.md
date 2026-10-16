# Crustacean Map packaging and CI

Ship reproducible Git installs using tracked ESM and declaration output. No install-time compiler or sibling checkout is required.

- Pin the development Sprite dependency to Git commit `1b14fe8fa436f70a7cc8673ac6d39f92c3d746fc`; retain the public `>=0.1.0` peer contract.
- Regenerate the lockfile in an empty retained directory, using no existing dependency tree.
- Track `dist/`, force LF compiler output, and compare a fresh isolated build against every shipped artifact.
- Run Node 22 CI on Ubuntu and Windows: locked installation, unit tests, distribution drift, real tarball installation, ESM imports, and TypeScript 4.6.4 consumers.
- Validate a retained clean source copy outside the workspace, excluding sibling dependencies and optional Farmsville checkout data.

# HUMAN QUESTIONS

Resolved: use tracked distribution rather than a `prepare` build hook; commit-pinned public HTTPS dependencies; retain validation artifacts; leave publication to the parent integration workflow.
