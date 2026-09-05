# System Context

```mermaid
flowchart LR
    RF[Requirements Factory]
    HA[Human Analyst]
    DI[Developer Issue]
    SP[Sprint or Backlog]
    DR[Customer Delivery Repository]
    OR[Delivery Orchestrator]
    DF[Development Factory]
    PR[Product Repository]
    HU[Human Control Surface]

    RF --> DR
    HA --> DR
    DI --> DR
    SP --> DR
    HU --> OR
    OR <--> DR
    OR --> DF
    DF --> PR
    DF --> DR
    PR --> OR
```

Every source is normalized into the same canonical requirement contract. The development factory receives approved work packages and is independent of the original requirement source.
