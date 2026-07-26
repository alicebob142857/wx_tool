ALTER TABLE writing_entries ADD COLUMN major_topic TEXT NOT NULL DEFAULT '';
ALTER TABLE writing_entries ADD COLUMN subtopic TEXT NOT NULL DEFAULT '';

UPDATE writing_entries
SET
  major_topic = CASE
    WHEN essay_title LIKE '%AI%' OR essay_title LIKE '%人工智能%' OR theme LIKE '%数字%' OR theme LIKE '%科技%' THEN '科技'
    WHEN essay_title LIKE '%生态%' OR essay_title LIKE '%绿色%' OR theme LIKE '%环境%' OR theme LIKE '%低碳%' THEN '生态'
    WHEN essay_title LIKE '%文旅%' OR theme LIKE '%文化%' OR theme LIKE '%文明%' THEN '文化'
    WHEN essay_title LIKE '%产业%' OR theme LIKE '%经济%' OR theme LIKE '%营商%' OR theme LIKE '%乡村振兴%' THEN '经济'
    WHEN essay_title LIKE '%实事求是%' OR essay_title LIKE '%改革%' OR essay_title LIKE '%担当%'
      OR essay_title LIKE '%党群%' OR theme LIKE '%党建%' THEN '政治'
    ELSE '社会'
  END,
  subtopic = CASE
    WHEN essay_title LIKE '%AI%' OR essay_title LIKE '%人工智能%' THEN '人工智能'
    WHEN essay_title LIKE '%实事求是%' THEN '理论作风'
    WHEN essay_title LIKE '%改革%' OR essay_title LIKE '%首创%' THEN '改革创新'
    WHEN essay_title LIKE '%担当%' OR essay_title LIKE '%向前一步%' THEN '干部担当'
    WHEN essay_title LIKE '%党群%' OR theme LIKE '%党建%' THEN '党建引领'
    WHEN essay_title LIKE '%社区%' OR theme LIKE '%社区%' THEN '社区服务'
    WHEN essay_title LIKE '%城市%' OR theme LIKE '%城市%' THEN '城市治理'
    WHEN essay_title LIKE '%青年%' OR essay_title LIKE '%青春%' THEN '青年成长'
    WHEN essay_title LIKE '%文旅%' OR theme LIKE '%文旅%' THEN '文旅融合'
    WHEN theme LIKE '%乡村振兴%' OR essay_title LIKE '%乡村振兴%' THEN '乡村振兴'
    WHEN theme LIKE '%生态%' OR essay_title LIKE '%绿色%' THEN '绿色发展'
    ELSE '公共服务'
  END
WHERE major_topic = '' OR subtopic = '';

CREATE INDEX IF NOT EXISTS idx_writing_entries_topic_published
  ON writing_entries(major_topic, subtopic, published_at DESC);
