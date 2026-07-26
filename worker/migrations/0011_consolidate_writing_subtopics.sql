UPDATE writing_entries
SET subtopic = CASE
  WHEN major_topic = '政治' AND subtopic IN ('改革创新', '法治建设') THEN '改革法治'
  WHEN major_topic = '政治' AND subtopic = '基层治理' THEN '党建引领'
  WHEN major_topic = '经济' AND subtopic IN ('区域协调', '消费发展') THEN '产业发展'
  WHEN major_topic = '社会' AND subtopic IN ('社区服务', '城市治理') THEN '城乡治理'
  WHEN major_topic = '社会' AND subtopic IN ('教育发展', '青年成长') THEN '教育成长'
  WHEN major_topic = '文化' AND subtopic = '文化自信' THEN '文化传承'
  WHEN major_topic = '生态' AND subtopic IN ('绿色发展', '低碳转型') THEN '绿色低碳'
  WHEN major_topic = '科技' AND subtopic IN ('数据发展', '网络安全') THEN '数字治理'
  ELSE subtopic
END;

UPDATE writing_entries
SET subtopic = CASE major_topic
  WHEN '政治' THEN '理论作风'
  WHEN '经济' THEN '产业发展'
  WHEN '社会' THEN '公共服务'
  WHEN '文化' THEN '文化传承'
  WHEN '生态' THEN '绿色低碳'
  WHEN '科技' THEN '科技创新'
  ELSE subtopic
END
WHERE
  (major_topic = '政治' AND subtopic NOT IN ('理论作风', '改革法治', '干部担当', '党建引领'))
  OR (major_topic = '经济' AND subtopic NOT IN ('产业发展', '营商环境', '就业人才', '乡村振兴'))
  OR (major_topic = '社会' AND subtopic NOT IN ('城乡治理', '公共服务', '民生保障', '教育成长'))
  OR (major_topic = '文化' AND subtopic NOT IN ('文化传承', '文明建设', '文旅融合', '文艺传播'))
  OR (major_topic = '生态' AND subtopic NOT IN ('绿色低碳', '环境治理', '生态保护', '美丽中国'))
  OR (major_topic = '科技' AND subtopic NOT IN ('人工智能', '数字治理', '科技创新', '产业升级'));
