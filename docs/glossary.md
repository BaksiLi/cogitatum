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
| Point | 點 | *punctum* | Authored content identified for independent discussion, including questions and fragments. / 具有個別身份、可獨立討論的內容，包括問題與短語。 |
| Bearing | 係 | *nexus* | An individually identified relation from source Points to a Point or Bearing, whether written explicitly or derived from indentation; a target Bearing need not be named. / 從來源點指向點或係、具有個別身份的關係；無論明示寫出或由縮排推得，所指的係不必命名。 |
| Linked | 聯結 | — | Several premises in one supporting step. / 多項前提共同參與一個支持步驟。 |
| Convergent | 匯聚 | — | Separate supporting steps toward one conclusion. / 不同支持步驟指向同一結論。 |
| Serial | 串聯 | — | A conclusion serving as a later premise. / 一步的結論成為後一步的前提。 |
| Joint participation | 共同參與 | *conjunctim* (adverb / 副詞) | Sources participating together in one step. / 來源共同參與同一個步驟。 |

See [argument structures](bearings.md#argument-structures) for examples.
Convergent, Linked and Serial name graph structures, not source keywords or judgments of reasoning strength or success.
Local `[_ G]` and explicit `[_ @a, @b +> @claim]` can each express Linked support when several sources participate together.
The constructor also permits a single source; it is complete without being Linked.
See the [syntax reference](syntax.md#local-bearing-constructions) for other local relations and migration from older spellings.

## Writing terms / 書寫用語

| English | 繁體中文 | Short meaning / 短義 |
| --- | --- | --- |
| Occurrence | 出現處 | One place in the source where a Point or Bearing is declared, constructed or used. / 點或係在原文中被宣告、建構或使用的一處。 |
| Role | 角色 | What a Point's content does at one occurrence: `Q`, `C`, `G`, `O`, `R` or `D`; not truth, a successful argument or a permanent type. / 內容在某一出現處的作用；不表示為真、論證成功或固定類型。 |
| Local mark | 局部標記 | The mark written at an occurrence: a role, `.` or a selector; it applies only there. / 寫在某一出現處的標記，只作用於該處。 |
| Local context | 局部上下文 | The nearest Point or Bearing occurrence that supplies the available target slots; ordinary body is transparent. / 最近的點或係出現處，決定可選取的局部目標；普通正文可被穿過。 |
| Explicit | 明示 | Written in the annotation itself: an operator clause or an explicit Bearing header states its kind and endpoints, unlike a relation derived from indentation. / 由標注本身寫明種類與端點，有別於由縮排推得的關係。 |
| Body | 正文 | Unmarked prose; it adds no Point or Bearing, and attachment by indentation passes through it. / 未標記的文字；不產生點或係，依縮排的附接可穿過它。 |
| Note | 附註 | Literal supplementary prose: `[note]` belongs to its source parent; `[. note]` and `[_ note]` annotate the selected object without new Points or Bearings. / 字面保留的補充文字：`[note]` 屬於原文父項，另兩種寫法註記所選實體，不新增點或係。 |
| Handle | 係名 | An authored name for a Bearing, written after `;`. / 以 `;` 寫在後面、為係所取的名字。 |
| Attachment | 附接 | The Bearing a Point occurrence constructs to its target, by default, selector or explicit clause; `G/`, `O/` and `Q/` beneath it select that attachment. / 點的某一出現處（依預設、選取或明示關係）向其目標建構的係；其下的 `G/`、`O/` 與 `Q/` 選取它。 |
| Route | 路徑 | Informal word for a Bearing seen as a step of reasoning, often named by a handle; not a separate type. / 把係視作推理步驟時的非正式說法，常以係名指稱；並非另一種類型。 |

## Points / 點

| Mark | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `[Q]` | Question | 問題 | 待考察的問題或議題。 |
| `[C]` | Claim | 主張 | 此處呈現的主張、立場或可能答案。 |
| `[G]` | Ground | 依據 | 用以支持所論的理由或材料。 |
| `[O]` | Objection | 駁議 | 對所論提出的異議或反對解釋。 |
| `[R]` | Reply | 回應 | 對另一個 Point 所作的回覆，不限於異議。 |
| `[D]` | Distinction | 辨別 | 指出有助釐清所論的區別。 |
| `[.]`, `[. @passage]` | Neutral Point | 中性點 | 沒有指定角色的內容，可選擇命名。 |
| `[. use @p]`, `[G use @p]` | Point use | 點的引用 | 再次使用同一個點；此處所寫的標記只作用於此處。 |
| — | Declaration | 宣告 | 引入一個新點，並寫明其初始標記。 |
| `G/`, `O/`, `Q/` | Local selector | 局部選取 | 支持、質疑或提問關涉最近建構處所呈現的係。 |

See [Points](points.md) for roles, neutral content, and names.

## Bearings / 係

| Mark or placement | Canonical English | 繁體中文讀法 | 短義 |
| --- | --- | --- | --- |
| `+>` | supports | 支持 | 正面作用於目標；不認證推論有效或依據充分。 |
| `->` | challenges | 質疑 | 對目標 Point 或 Bearing 提出反對。 |
| `~>` | concerns | 關涉 | 記錄相關性，不承諾正面或反面作用。 |
| Explicit `answers` | answers | 回答 | 作者明示某個 Point 回答另一個 Point；Q 下的 C 不自動產生此關係。 |
| Reply beneath a Point | repliesTo | 回應 | R 回應最近的外層 Point，不要求目標標成 O。 |
| Distinction beneath a Point | clarifies | 釐清 | D 用來釐清最近的外層 Point。 |

See [Bearings](bearings.md) for indentation, joint support, and target restrictions,
and the [quick start](quick-start.md#writing-and-reconstruction) for a reconstruction example.
