---
title: English / 繁體中文 glossary
summary: A compact terminology aid for reading and reconstructing arguments; English names remain canonical.
section: reference
order: 3
---

# English / 繁體中文 glossary

English names remain canonical in Cogitatum's language and machine contracts.
The Traditional Chinese terms below are suggested reading and reconstruction aids, not a Chinese syntax, a separate terminology registry, or a required translation standard.
Prose can use any language; marks and names follow the [syntax reference](syntax.md).

以下中文詞語供閱讀與論證重構時參考。
它們不改變標記的編譯效果，也不替原作者或重構者判定論證是否成立。

## Points / 標記的內容

| Mark | English | 繁體中文輔助詞 | 閱讀提示 |
| --- | --- | --- | --- |
| `[Q]` | Question | 問題 | 待考察的問題或議題。 |
| `[C]` | Claim | 主張 | 此處呈現的主張、立場或可能答案；不保證為真或已獲接受。 |
| `[C?]` | Open claim | 開放主張 | 明確保留開放狀態的主張；不是低信心分數。 |
| `[G]` | Ground | 依據 | 用來正面支持目標的理由；reason 是說明用語，正式名稱仍是 Ground。 |
| `[O]` | Objection | 駁議 | 對目標提出的異議或反對方向的替代解釋。 |
| `[R]` | Reply | 回應 | 對異議的回應；不保證已成功反駁。 |
| `[D]` | Distinction | 區分 | 有助釐清目標的區分。 |
| `[?]` | Gap | 缺口 | 明確保留的缺漏或尚待補足之處。 |
| `[@passage]` | Material | 材料 | 有名稱、沒有指定角色的內容。 |

Point 指一處被標記的內容，不必是可判真假的命題。
Point 名稱用來指稱內容或角色；Bearing 種類用來說明關係，中文不必強求詞性或字數一致。
六種角色是 Q、C、G、O、R、D；C? 是 C 加上開放狀態。
Gap 與 Material 是另外兩種 Point 形式，不是額外角色。
缺口本身具有開放狀態。
「可能 P」是主張的內容，不機械等於 C?；是否保留開放狀態，取決於該探究如何提出這個主張。

## Bearings / 內容之間的關係

A Bearing connects one or more Points to a target Point or named Bearing.
中文可讀作「內容對目標的作用關係」；下表保留英文種類名以便對照編譯結果。

| Mark or placement | English kind | 繁體中文輔助詞 | 閱讀提示 |
| --- | --- | --- | --- |
| `+>` | supports | 支持 | 正面作用於目標；不等於邏輯蘊涵，也不認證推論有效或依據充分。 |
| `->` | challenges | 質疑 | 對目標 Point 提出反對；不必是對其命題作邏輯否定。 |
| `_>` | undercuts | 質疑關係 | 作用於已命名的任一合法 Bearing；可質疑理由如何支持目標，而不直接否定目標。 |
| `~>` | about | 關涉 | 記錄相關性，不承諾正面或反面作用；不是信心較低的 supports。 |
| Claim beneath Question | answers | 回答 | 最近的外層 Point 是 Q 時，C 或 C? 回答它；不保證答案正確。 |
| Reply beneath Objection | repliesTo | 回應異議 | 最近的外層 Point 是 O 時，R 回應它。 |
| Distinction beneath a Point | clarifies | 釐清 | D 用來釐清最近的外層 Point。 |

The full [indentation rules](bearings.md#connections-from-indentation) also connect Grounds, Objections, and Gaps.
`answers`, `repliesTo`, and `clarifies` have no explicit operators in this version.

| English expression | 繁體中文輔助詞 | 閱讀提示 |
| --- | --- | --- |
| Joint support | 聯合支持 | 多個來源共同形成一條支持關係；不同於多條各自的支持關係。以局部 `join` 或多來源 `edge` 表達；兩者都建立 Bearing，不是 Point role。參見 [Bearings](bearings.md#local-joint-reasons)。 |
| Inference | 推論 | 推論方法與是否有效需由內容另行說明；supports 不指定演繹、歸納、溯因等方法。 |
| Assertion and truth | 斷言與真值 | 記錄某人主張甚麼，與判定該主張為真，是不同工作。 |
| Indentation-based authoring | 縮排式寫作 | 利用相鄰層級及角色形成預設關係。 |
| Explicit-relation authoring | 明示關係式寫作 | 以 operator 指定關係及目標；可與縮排式混用，不是另一種 input mode。 |

## Reconstruction / 重構時的用法

重構時，先辨明標記保留的是原作者的承諾，還是重構者自己的問題。
原作者的主張或保留、你對文本解讀的把握、你對論證的評價，應在文字中分清；
C? 沒有區分發言者的欄位，不能讓一個未說明的問號同時承載三者。
原文明確主張的內容，不應只因你不同意或尚未理解，就全部改成 C?。
原文明示的支持關係，也不應只因你尚未辨清推理方法，就長期以 `~>` 模糊帶過。
但不必強迫每處材料都分類成支持或質疑。

原文確實保留開放主張或只有相關性時，C? 和 `~>` 都可忠實保留這些承諾。
`~>` 是明確的關涉關係，不是尚未分類的 supports，也不必等待升級。
原文不明確時，可保留文字說明，或用 Question／Gap 明說這是重構者的疑問，避免虛構原作者立場。
從構思到重構，不意味 C? 必須改成 C，也不意味 `~>` 必須改成 `+>`。
以上是寫作建議，不是新增編譯規則；參見 [quick start 的例子](quick-start.md#writing-and-reconstruction)。
