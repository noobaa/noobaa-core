### Purpose
- Besides making the world a better place it also ...

### Checklist 
*Notice 1: you can create the PR and keep pushing commits until all relevant items are marked*  
*Notice 2: Mark N/A for irrelevant items below*  

- [ ] Failure handling - describe how it behaves on failures:
 - **Delay and retry** / **Return error to the user**
- [ ] Platforms handling - describe how it behaves on different platforms:
 - **Agnostic** / **Handled**
- [ ] Technical debt - open issues and describe which gaps are postponed:
 - [ ] **Does not support XXX - issue #xxxx**
- [ ] Code Review - with someone besides myself:
 - [ ] **@mention Reviewed** / **Please review XXX**
- [ ] Supportability:
 - [ ] Diagnostics info - added if needed : **Logs / Files**
 - [ ] Phone Home info - added if needed : **Stats / Actions**
 - [ ] ActivityLog new events if needed
 - [ ] External Syslog events if needed
- [ ] Upgrade Conciderations:
 - [ ] Mongo Schema Upgrade if needed
 - [ ] Platform dependency added
- [ ] Code Comments - on non-trivial parts
- [ ] Tests Coverage:
 - [ ] **Already covered by ...**
 - [ ] **Added tests ...**
 - [ ] Tested with `npm test`

### Issues References
- Fixes #xxxx (for multiple issues: use Fixes #xxxx, Fixes #yyyy)
- Opened #yyyy
