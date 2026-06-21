# 大学物理C 选择题题库

## 启动

```powershell
npm start
```

默认地址：

- 刷题页：http://localhost:3000/
- 题库管理页：http://localhost:3000/admin.html

如需换端口：

```powershell
$env:PORT=3100
npm start
```

## 数据库

题库数据在：

```text
data/physics_quiz_db.json
```

可以直接编辑这个 JSON，也可以打开管理页编辑并保存。

## API

- `GET /api/db`：读取完整题库
- `PUT /api/db`：保存完整题库
- `GET /api/chapters`：读取章节摘要
- `GET /api/chapters/:chapterId/questions`：读取某章题目
- `POST /api/chapters/:chapterId/questions`：向某章追加题目
- `GET /api/chapters/:chapterId/questions/:questionNo`：读取某题
- `PUT /api/chapters/:chapterId/questions/:questionNo`：替换某题
- `DELETE /api/chapters/:chapterId/questions/:questionNo`：删除某题

题目结构：

```json
{
  "q": "题干",
  "opts": {
    "A": "选项 A",
    "B": "选项 B",
    "C": "选项 C",
    "D": "选项 D"
  },
  "ans": "A"
}
```
