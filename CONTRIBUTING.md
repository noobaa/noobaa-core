Contributing to NooBaa
===========

We're happy to get your input on the project. Please consider the following before submitting an issue  


## Submitting New Issues


   1. Make a basic search on keywords to verify there is no existing issue describing the same problem. If there is, please add your information in that issue's discussion instead of opening a new one.
   2. Provide a clear descriptive title to the issue.  
   3. Follow the issue template and provide  
     - General information of Version, Deployment  
     - Actual Behavior - What did you observe, what happened  
     - Expected Behavior - What did you expect to happen  
     - Steps to reproduce - How can the issue be reproduced so a fix can be verified  
     - Add screenshots or log parts which can be helpful to investigate the issue  

#### Issue Labels
Issue labels are divided into several categories:  
  - Comp-X - This label indicates the issue is within a certain component of the project  
  - Closed X - For issues closed without fixing, this is the closing reason (dup, no repro, no fix)  
  - Compatibility X - Compatibility with a certain protocol (AWS S3, AWS Lambda, Azure Blob)  
  - Deployment X - Kubernetes or Virtual Appliance specifically related  
  - Priority X - Priority for fixing the issue  
  - Severity X - Severity of the issue  
  - Type X - Bug, UI Gap (Mock differs from actual implementation due to time constraints), enhancement  
  - UX Classification - You can read more of UX issues classification [here](https://github.com/noobaa/noobaa-core/wiki/UX-Issues)  
  - Misc labels (such as needs investigation, supportability etc)


## Submitting Code
---MISSING---  


- Please verify regression by running the unit tests and the system tests on your code  
- Update existing tests (unit and/or system) on changed flows  
- Add new tests (unit and/or system) to the the new flows added  
- Create a PR and provide an explanation to what the changes to the code are & why are they required  
- Mark any fixed issues in the PR as well as new issues (technical debts or otherwise) which will be created with the submittion of the PR  
- Open the relevant issues   
- Update the needed architecture pages regarding new components or changes to existing components  


---MISSING---

#### Coding Style

---MISSING---

You can run eslint to verify various coding style patterns.
