// 拼豆图纸生成调度云函数（与本地代理服务 tools/ai-generate-server.js 保持一致）
// 异步任务模式：客户端 callFunction 单次等待约 15s 即超时（-404012），Seedream 生成需 30~60s，
// 且微信云函数单次执行时长上限固定 60s（无法调大），生成无法塞进同一次调用；因此拆成两层独立调用：
//   start：校验登录 → 写 ai_tasks 任务记录（pending，生成参数存云存储 JSON）
//          → 云调用 addDelayedFunctionTask 延时约 7s 触发独立 worker 云函数 ai-generate-worker
//          → 立即返回 { ok, taskId }（毫秒级返回，不占用生成时长）
//   worker（ai-generate-worker，独立部署）：拥有自己完整的 60s 执行预算，调火山方舟 Seedream
//          （doubao-seedream-5-0-260128，OpenAI 兼容 images/generations）生成像素风格图纸 → 下载图片
//          → 上传云存储 ai-tasks/<openid>/<taskId>.<ext> → 更新任务 done/error
//   status：按 _openid + taskId 查询，返回 { ok, status, fileID, ext, error }，前端轮询后下载
// 云调用权限：本函数目录 config.json 声明 openapi: ["cloudbase.addDelayedFunctionTask"]，
//             重新上传部署后权限缓存约 10 分钟生效。
// 环境变量：ARK_API_KEY / ARK_MODEL 配置在 ai-generate-worker；本函数无需配置，超时保持默认 60s。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const TASK_COLLECTION = 'ai_tasks' // 异步任务记录集合（start 写 pending，worker 更新 done/error）
const WORKER_NAME = 'ai-generate-worker' // 独立生成 worker，需与调度函数部署到同一环境

function newTaskId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

async function ensureTaskCollection() {
  try {
    await cloud.database().createCollection(TASK_COLLECTION)
  } catch (e) {
    // 集合已存在或当前环境不支持时忽略，后续 add 失败会返回明确错误
  }
}

exports.main = async (event) => {
  event = event || {}
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID
  if (!OPENID) return { ok: false, error: '请先登录' }
  const action = event.action || 'start' // 兼容旧调用：不带 action 视为 start

  if (action === 'status') {
    if (!event.taskId) return { ok: false, error: '缺少 taskId' }
    try {
      const res = await cloud
        .database()
        .collection(TASK_COLLECTION)
        .where({ _openid: OPENID, taskId: event.taskId })
        .limit(1)
        .get()
      const task = res.data && res.data[0]
      if (!task) return { ok: false, error: '任务不存在' }
      return {
        ok: true,
        status: task.status,
        fileID: task.fileID || '',
        ext: task.ext || 'jpg',
        error: task.error || ''
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }
  if (action !== 'start') {
    return { ok: false, error: '未知 action: ' + action }
  }

  const taskId = newTaskId()
  const now = Date.now()
  let paramsFileID = ''
  try {
    await ensureTaskCollection()
    // 生成参数含原图/上一版结果两张 base64 图，可能逼近数据库单条记录上限（512KB），
    // 单独存云存储 JSON，worker 按 paramsFileID 下载还原；ai_tasks 记录只保留轻量元数据
    const paramsFile = await cloud.uploadFile({
      cloudPath: 'ai-tasks/' + OPENID + '/' + taskId + '.json',
      fileContent: Buffer.from(JSON.stringify(event), 'utf8')
    })
    paramsFileID = paramsFile.fileID
    await cloud
      .database()
      .collection(TASK_COLLECTION)
      .add({
        data: {
          _openid: OPENID,
          taskId,
          status: 'pending',
          fileID: '',
          ext: 'jpg',
          error: '',
          paramsFileID,
          createdAt: now,
          updatedAt: now
        }
      })
  } catch (e) {
    if (paramsFileID) {
      try {
        await cloud.deleteFile({ fileList: [paramsFileID] })
      } catch (cleanupErr) {
        console.error('[ai-generate-pattern] 清理参数文件失败:', cleanupErr)
      }
    }
    return { ok: false, error: '任务创建失败: ' + e.message }
  }
  // 延时触发独立 worker（延时下限 6s，取 7s 保证记录与参数文件已提交）；
  // worker 独立调用拥有完整 60s 预算。若调度失败，前端会立即得到失败并自动重提。
  try {
    await cloud.openapi.cloudbase.addDelayedFunctionTask({
      env: wxContext.ENV || process.env.TCB_ENV,
      functionName: WORKER_NAME,
      data: JSON.stringify({ openid: OPENID, taskId }),
      delayTime: 7
    })
  } catch (e) {
    console.error('[ai-generate-pattern] 延时调度失败:', e)
    try {
      await cloud.database().collection(TASK_COLLECTION).where({ _openid: OPENID, taskId }).remove()
    } catch (cleanupErr) {
      console.error('[ai-generate-pattern] 清理任务记录失败:', cleanupErr)
    }
    if (paramsFileID) {
      try {
        await cloud.deleteFile({ fileList: [paramsFileID] })
      } catch (cleanupErr) {
        console.error('[ai-generate-pattern] 清理参数文件失败:', cleanupErr)
      }
    }
    return { ok: false, error: '生成任务调度失败，请重试', detail: e.message }
  }
  console.log('[ai-generate-pattern] 已创建并调度任务:', taskId)
  return { ok: true, taskId }
}
