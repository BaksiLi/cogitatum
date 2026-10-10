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

## Concepts / 概念

| English | 繁體中文 | Latin | Short meaning / 短義 |
| --- | --- | --- | --- |
| Point | 點 | *punctum* | An identity-bearing piece of marked material. / 具有個別身份的標記內容。 |
| Bearing | 係 | *nexus* | An individually identified relation from source Points to a Point or Bearing. / 從來源點指向點或係、具有個別身份的關係。 |
| Linked | 聯結 | — | Several premises in one supporting step. / 多項前提共同參與一個支持步驟。 |
| Convergent | 匯聚 | — | Separate supporting steps toward one conclusion. / 不同支持步驟指向同一結論。 |
| Serial | 串聯 | — | A conclusion serving as a later premise. / 一步的結論成為後一步的前提。 |
| Joint participation | 共同參與 | *conjunctim* (adverb / 副詞) | Sources participating together in a linked step. / 來源共同參與一個聯結步驟。 |

See [argument structures](bearings.md#argument-structures) for examples.

## Points / 點

| Mark | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `[Q]` | Question | 問題 | 待考察的問題或議題。 |
| `[C]` | Claim | 主張 | 此處呈現的主張、立場或可能答案。 |
| `[C?]` | Open claim | 開放主張 | 明確保留開放狀態的主張；不是低信心分數。 |
| `[G]` | Ground | 依據 | 用以支持所論的理由或材料。 |
| `[O]` | Objection | 駁議 | 對所論提出的異議或反對解釋。 |
| `[R]` | Reply | 回應 | 對異議所作的答覆。 |
| `[D]` | Distinction | 辨別 | 指出有助釐清所論的區別。 |
| `[?]` | Gap | 闕漏 | 明示尚待補足之處。 |
| `[.]`, `[. @passage]` | Neutral Point | 中性點 | 沒有指定角色的內容，可選擇命名。 |

See [Points](points.md) for roles, open status, and names.

## Bearings / 係

| Mark or placement | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `+>` | supports | 支持 | 正面作用於目標；不認證推論有效或依據充分。 |
| `->` | challenges | 質疑 | 對目標 Point 提出反對。 |
| `/>` | undercuts | 質疑關係 | 質疑已命名的 Bearing。 |
| `~>` | about | 關涉 | 記錄相關性，不承諾正面或反面作用。 |
| Claim beneath Question | answers | 回答 | 最近的外層 Point 是 Q 時，C 或 C? 回答它。 |
| Reply beneath Objection | repliesTo | 回應異議 | 最近的外層 Point 是 O 時，R 回應它。 |
| Distinction beneath a Point | clarifies | 釐清 | D 用來釐清最近的外層 Point。 |

See [Bearings](bearings.md) for indentation, joint support, and target restrictions,
and the [quick start](quick-start.md#writing-and-reconstruction) for a reconstruction example.
