# run 团队可见(子项目 F1)设计

> 承接 D2(场景可见性 private/team)。让团队共享场景的运行记录对团队成员可见。

**目标:** run 跟随其场景的可见性——团队共享场景的所有 run 对该团队成员可见(含步骤/装配产出),历史里标明 run 由谁运行;私有场景的 run 仍仅 owner。

**架构:** 仅改 `server/db.ts` 的 `getRun`/`listRuns` 可见性(join 场景 team_id + team_members),`RunSummary` 增 `owner_name`;前端 `RunHistory` 显示所属用户名。后端路由签名、前端调用不变。

**分支:** `main`(A–D2 + 并发上限已完成)。

---

## 可见性规则

一条 run 对用户 U 可见,当且仅当:
- `run.owner_id = U`,**或**
- 该 run 的场景(`runs.scenario_id` → `scenarios.team_id`)有 `team_id` 且 U 是该团队成员(`team_members`)。

即:**run 跟场景走**。团队共享场景 → 其全部 run 对成员可见;私有场景 → run 仅 owner。

## db 改动(`server/db.ts`,签名不变)

- `getRun(db, runId, userId)`:取 run + 其场景 `team_id`;可见判定 = `owner_id===userId || (team_id!=null && 存在 team_members(team_id,userId))`;不可见返回 `null`。
- `listRuns(db, userId, scenarioId?)`:
  ```sql
  WHERE (scenario_id = :sid)  -- 当传 scenarioId 时
    AND ( owner_id = :uid
          OR scenario_id IN (
            SELECT s.id FROM scenarios s JOIN team_members m ON m.team_id = s.team_id WHERE m.user_id = :uid ) )
  ORDER BY created_at DESC
  ```
  无 `scenarioId` 时同理去掉场景过滤(返回我拥有的 + 我能见团队场景的全部 run)。
- `RunSummary`/`listRuns` 行增 `owner_name`(`LEFT JOIN users u ON u.id = runs.owner_id`,旧无主 run 的 owner_name 为 null)。`getRun` 的详情亦可带 `owner_name`(可选;UI 列表已足够)。

## 前端

- `src/api/client.ts`:`RunSummary` 接口加 `owner_name: string | null`。
- `src/components/RunHistory.tsx`:列表项时间旁显示 `由 {owner_name}`(owner_name 为空则不显示)。私有场景里恒为自己,团队场景里区分谁跑的。

## 边界 / 非目标

- run 跟场景走,不做 per-run 单独共享开关。
- 跨成员**实时**观看进行中的 run:依赖 `getRun` 快照可见即可(`sseForRun` 用 getRun 取快照),不额外处理 runHub 订阅鉴权(运行多为历史回看)。
- 删除 run、run 级权限细分:不在本期。
- 旧无主 run(owner_id NULL):listRuns 仍按 owner 过滤排除(D1 既有语义),owner_name 为 null。

## 测试

- `db.test.ts`:
  - 团队成员能 `listRuns`/`getRun` 看到队友对**共享场景**的 run;
  - 非成员看不到(listRuns 不含、getRun 返回 null);
  - **私有场景**的 run 仍仅 owner 可见(回归 D1);
  - `listRuns` 行含 `owner_name`。
- 集成 `server.integration.test.ts`:A、B 同队,场景共享给团队,A 跑一次 → B `GET /api/runs?scenarioId=` 含该 run、`GET /api/runs/:id` 200;非成员 C 404 / 不含。
- 前端:tsc + 浏览器人工(B 在历史里看到 A 的 run,标「由 ta」)。

## 完成判据

- A、B 同团队、场景共享给团队;A 运行该场景 → B 历史里看到 A 的 run(标所属)+ 可重看产出;非成员看不到;私有场景 run 仍仅自己可见。
- `bun test` 全绿(现有 81 + F1 db/集成);`tsc` 干净;`bun run build` 成功。
