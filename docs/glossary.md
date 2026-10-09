---
title: English / 繁體中文 glossary
summary: Marks, canonical English names, suggested Chinese readings, and short meanings.
section: reference
order: 3
---

# English / 繁體中文 glossary

English names remain canonical in Cogitatum's language and machine contracts.
The Traditional Chinese terms below are suggested readings; they do not change the marks or compiler contracts.
Prose can use any language; marks and names follow the [syntax reference](syntax.md).

## Points / 標記的內容

| Mark | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `[Q]` | Question | 問題 | 待考察的問題或議題。 |
| `[C]` | Claim | 主張 | 此處呈現的主張、立場或可能答案。 |
| `[C?]` | Open claim | 開放主張 | 明確保留開放狀態的主張；不是低信心分數。 |
| `[G]` | Ground | 依據 | 用來正面支持目標的理由。 |
| `[O]` | Objection | 駁議 | 對目標提出的異議或反對方向的替代解釋。 |
| `[R]` | Reply | 回應 | 對異議的回應；不保證已成功反駁。 |
| `[D]` | Distinction | 區分 | 有助釐清目標的區分。 |
| `[?]` | Gap | 缺口 | 明確保留的缺漏或尚待補足之處。 |
| `[@passage]` | Material | 材料 | 有名稱、沒有指定角色的內容。 |

See [Points](points.md) for roles, open status, and names.

## Bearings / 內容之間的關係

| Mark or placement | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `+>` | supports | 支持 | 正面作用於目標；不認證推論有效或依據充分。 |
| `->` | challenges | 質疑 | 對目標 Point 提出反對。 |
| `_>` | undercuts | 質疑關係 | 質疑已命名的 Bearing。 |
| `~>` | about | 關涉 | 記錄相關性，不承諾正面或反面作用。 |
| Claim beneath Question | answers | 回答 | 最近的外層 Point 是 Q 時，C 或 C? 回答它。 |
| Reply beneath Objection | repliesTo | 回應異議 | 最近的外層 Point 是 O 時，R 回應它。 |
| Distinction beneath a Point | clarifies | 釐清 | D 用來釐清最近的外層 Point。 |

See [Bearings](bearings.md) for indentation, joint support, and target restrictions,
and the [quick start](quick-start.md#writing-and-reconstruction) for a reconstruction example.
