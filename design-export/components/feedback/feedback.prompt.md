Toast / Dialog — transient + modal feedback.

```jsx
<Toast show={added}>フォルダに追加しました</Toast>

<Dialog open={confirm} title="投稿を削除" onClose={cancel}
  footer={<><Button onClick={cancel}>キャンセル</Button><Button variant="danger" onClick={del}>削除する</Button></>}>
  この投稿を削除しますか？この操作は元に戻せません。
</Dialog>
```

Toast is a dark bottom-center pill (caller controls `show` + auto-dismiss). Dialog is a centered modal with header/body/footer; scrim click and × both call `onClose`. Pair Dialog footers with Button.
