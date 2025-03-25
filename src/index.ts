import { Context, Schema, Logger, Time, $, h} from 'koishi'
import cron from 'node-cron';
import path from 'path';
import { config } from 'process';

export const name = 'winp'

export interface Config {
  sayingsUrl: string
  apiUrl: string
  displayFullId: boolean
  outputLogs: boolean
  sendImg: boolean
  searchNum: number
}
export const usage = `
<hr>
<div class="notice">
<h3>Notice</h3>
-本插件在resource文件夹内提供一份语录-</div>

【如需自定义,可自行修改语录json文件】
<h4>提醒：语录库仅供娱乐目的使用，请勿在群聊内利用本语录库:</h4></div>
<ul>
  <li>点评敏感人物、事件</li>
</ul>
<ul>
  <li>发起人身攻击</li>
  
  ——插件作者及语录整理者对因不适当使用而造成的损失概不负责
</ul>


<h4>p.s:如果遇到图发不出来的情况，请尝试手动访问: <a href="https://zvv.quest/">VVQuest </a> 来确定此服务运行状态</h4>

<hr>
<div class="version">
<h3>Version</h3>
<p>1.0.2</p>
<ul>
<li>接入表情包api，为ask命令添加了发图功能</li>
<li>删除了ask.update在线更新语录库的功能，使用本地语录库</li>

</ul>
<hr>
<div class="thanks">
<h3>Thanks</h3>
<p>原插件： <a href="/market?keyword=koishi-plugin-win">koishi-plugin-win</a></p>
<p>表情包检索服务: <a href="https://www.bilibili.com/video/BV1WLK5eDEzT/">【VVQuest——不用担心VV表情包不够用了！】  </p>
<hr>
<h4><a href="https://github.com/xsjh/koishi-plugin-winp/pulls" target="_blank">如果想继续开发优化本插件，欢迎PR</a></h4>
</body>
`;

export const Config = 
  Schema.intersect([
    Schema.object({
      sayingsUrl: Schema.string().default('./resource/words.json').description('张教授语录库地址'),
    }).description('基础设置'),
    Schema.object({
      sendImg: Schema.boolean().default(true).description('是否在ask之后展示张教授表情包'),
      apiUrl: Schema.string().default('https://api.zvv.quest/search').description('表情包查询api'),
      searchNum: Schema.number().min(1).max(50).default(15).description('一次性查询的图片数量（数量越大等待时间越长）'),
    }).description('图片设置'),
    Schema.object({
      displayFullId: Schema.boolean().default(false).description('是否在rank中展示群聊与用户的完整id'),
      outputLogs: Schema.boolean().default(false).description('日志调试模式，如有报错可开启进行排查'),
    }).description('调试设置'),
    
  ]);



export const logger = new Logger('winp');

export const using = ['console', 'database']

const fs = require('fs');



declare module 'koishi' { // 创建插件数据表
  interface Tables {
    zvv: zvv
  }
}

export interface zvv {
  id: number
  targetId: string //用户账号
  targetName: string //用户名，用于排行时展示
  month: number
  day: number
  win: number
  group: number
  winLater: boolean //共同富win功能中，用于标识双赢者
  miniWinDays: number //精准扶win功能中，用于标识小赢天数
}

let windWindow = -1; //风口
let hasBlowed = []; //存储有人乘着风口win过的群组

const generatewindWindow = cron.schedule('0 0 * * *', () => {
  const randomHour = Math.floor(Math.random() * 13) + 9;
  exports.logger.success('The wind-window today is ' + randomHour + '.');
  windWindow = randomHour;
  hasBlowed = [];
});

export function apply(ctx: Context, config: Config) {
  registerCommand(ctx, config);
  generatewindWindow.start();
  ctx.on('dispose', () => {
    // 若插件被停用，则清除计时器
    generatewindWindow.stop();
  });
  ctx.model.extend('zvv', {
    // 记录各群各人win情况
    id: 'unsigned',
    targetId: 'string',
    targetName: 'string',
    month: 'integer',
    day: 'integer',
    win: 'integer',
    group: 'integer',
    winLater: 'boolean',
    miniWinDays: 'integer'
  }, {
    autoInc: true,
  }
  )
}

async function getRandom() {
  //获取1-100随机数
  const num = Math.floor(Math.random() * (100 - 1 + 1)) + 1;
  return num;
}
async function getWin(num) {
  //获取赢的结果，概率分别为2、48、25、17、5、2、1，此外还有num为1与2时的微赢。
  //const win = ['灵活赢', '小赢', '中赢', '大赢', '特大赢', '赢麻了','输'];
  let result = 0;
  if (num >= 100) result = 6; //输
  else if (num >= 98) result = 5; //赢麻了
  else if (num >= 93) result = 4; //特大赢
  else if (num >= 76) result = 3; //大赢
  else if (num >= 51) result = 2; //中赢
  else if (num >= 3) result = 1; //小赢
  return result;
}
async function getDate() {
  //返回当前日期
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  date[0] = month;
  date[1] = day;
  date[2] = hour;
  return date;
}

function getRandomElement(array) {
  //用于从数组中抽取随机元素
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

async function getInterpret(date, name, newWin, winIndex, rate, hasTargetedWinAssist, tempBlowed) {
  //解读赢的结果，其中newWin表示是否今日刚赢
  const month = date[0], day = date[1];
  const win = ['灵活赢。', '小赢。', '中赢。', '大赢。', '特大赢。', '赢麻了。', '输！'];
  const msg = [
    ['维为寄语：我真的觉得我们千万不能太天真。\n（提示：试试再win一次）', '维为寄语：好像真的要出大问题。\n（提示：试试再win一次）', '维为寄语：现在这个水准还是太低了。\n（提示：试试再win一次）', '维为寄语：我们决不允许这样。\n（提示：试试再win一次）', '维为寄语：这个差距将被克服。\n（提示：试试再win一次）', '维为寄语：真是什么问题都不能回避了。\n（提示：试试再win一次）'],
    ['维为寄语：我觉得我们真的要自信一点。','维为寄语：只要你自信，怎么表达都可以。', '维为寄语：我们一点都不害怕竞争。', '维为寄语：我们的回旋余地特别大。', '维为寄语：很显然就是觉得不服气。'],
    ['维为寄语：我想更精彩的故事还在后面。', '维为寄语：这使美国感到害怕了。', '维为寄语：现在确实在开始超越美国了。', '维为寄语：至少美国今天还做不到。'],
    ['维为寄语：这个趋势还会持续下去。', '维为寄语：我们已经不是一般的先进了。', '维为寄语：我们不是一般的领先，对不对？', '维为寄语：别人都不可能超越我们。', '维为寄语：很好地展示了一种自信。', '维为寄语：这是基本的趋势。', '维为寄语：怎么评价都不过分。'],
    ['维为寄语：这是中国崛起最精彩的地方。', '维为寄语：我们已经对美国形成了巨大的压力。', '维为寄语：必须给美国迎头痛击！', '维为寄语：你真可能会创造世界奇迹的。', '维为寄语：这种自信令人有点回味无穷。', '维为寄语：完胜所有西方国家。', '维为寄语：孰优孰劣一目了然。'],
    ['维为寄语：已经震撼了这个世界。', '维为寄语：这是一种发自内心的钦佩。', '维为寄语：这种震撼效果前所未有。', '维为寄语：至今引以为荣。', '维为寄语：结果是一锤定音、釜底抽薪的胜利。'],
    ['教授寄语：你赢赢赢，最后是输光光。']
  ];
  const targetedWinAssistMsg = ['维为寄语：现在美国竞争不过我们。','维为寄语：我们要更上一层楼了。','维为寄语：我们手中的牌太多了。', '维为寄语：现在我们有很多新的牌可以打。', '维为寄语：该出手的时候一定要出手。', '维为寄语：局面马上就打开了。', '维为寄语：通过了这场全方位的压力测试。']

  if (hasTargetedWinAssist) {//精准扶win
    let result = '';
    result += '恭喜 ' + name + ' 在' + date[0] + '月' + date[1] + '日受到精准扶win，赢级提高40%！\n' + name + ' 当前赢级是：' + rate + '%，属于';
    return result + win[winIndex] + '\n' + getRandomElement(targetedWinAssistMsg);
  }
  if (!newWin && rate > 2) {//已经win过
    let result = name + '已经在' + month + '月' + day + '日赢过了，请明天再继续赢。\n' + '你今天的赢级是：' + rate + '%，属于';
    return result + win[winIndex];
  }
  if (tempBlowed) {//乘上风口
    let result = '恭喜 ' + name + ' 在' + date[0] + '月' + date[1] + '日乘上风口，赢级提高40%！\n' + name + ' 的赢级是：' + rate + '%，属于';
    return result + win[winIndex] + '\n' + getRandomElement(msg[winIndex]);
  }
  else {//正常win
    let result = '恭喜 ' + name + ' 在' + date[0] + '月' + date[1] + '日赢了一次！\n' + name + ' 的赢级是：' + rate + '%，属于';
    return result + win[winIndex] + '\n' + getRandomElement(msg[winIndex]);
  }
}

async function CommonProsperity(ctx, session, rate) {
  //共同富win，只有在榜一是大赢时才能帮扶
  const date = await getDate();//获取当前日期，数组下标0为月份，1为日期
  let result = await ctx.database.get('zvv', {
    month: date[0],
    day: date[1],
    group: session.guildId
  }, ['targetId', 'targetName', 'win']);//查出的内容包括用户账号及赢级
  let winnest = 0;
  let winnester = '';
  let winnestId = '';
  result.forEach((item) => {
    if (item.win > winnest) {
      winnest = item.win;
      winnester = item.targetName;
      winnestId = item.targetId;
    }
  });//找出最赢的人

  if (winnest < 76) {
    //榜一不是大赢以上
    await session.sendQueued('最赢者不够努力，赢级尚未达到大赢，无力帮扶。');
    return [-1, ''];
  }
  const msg = ['维为寄语：令人感动之至。', '维为寄语：有时候是能合作共赢的。', '维为寄语：不要再不自信了。', '维为寄语：这一定是美丽的。'];
  const nowWin = Math.round((winnest + rate) / 2);
  await session.sendQueued('恭喜你在 ' + winnester + ' 的帮扶下实现共同富win，使赢级达到了' + nowWin + '%！\n' + getRandomElement(msg), 5 * Time.second);
  return [nowWin, winnestId];
}

async function isTargetIdExists(ctx, targetId, group) {
  //检查数据表中是否有指定id者
  const targetInfo = await ctx.database.get('zvv', { targetId: targetId, group: group });
  return targetInfo.length !== 0;
}

function transform(arr) {
  //用于将日期存入数组
  let newArr = [];
  arr.forEach((item) => {
    newArr[0] = item.month;
    newArr[1] = item.day;
    newArr[2] = item.win;//这里的win是被抽到的随机数
  });
  return newArr;
}

function getRandomLineFromFile(jsonpath) {
  // 随机获取语录
  try{
    const filePath = path.resolve(jsonpath); // 解析文件路径   
    const fileContent = fs.readFileSync(filePath, 'utf8'); // 读取 JSON 文件内容
    const lines = fileContent.split('\n'); // 按行分割内容
    const randomIndex = Math.floor(Math.random() * lines.length); // 随机抽取一行
    const result = lines[randomIndex].trim(); // 使用 trim() 去除可能的首尾空格或换行符
    return result;
  }catch(error){
    console.error('读取文件时出错:', error);
  }
}


async function fetchImageUrls(apiUrl, ctx, config){
  // 从api获取表情包
  try {
    const api_res = await ctx.http.get(apiUrl);
    console.log('api返回结果：',api_res);
    if(api_res.data.length > 0){
      // 从提取的图片 URL 列表中随机选择一个
      const randomIndex = Math.floor(Math.random() * api_res.data.length);
      if(config.outputLogs){
        logger.info('随机提取的url:', api_res.data[randomIndex]);
      }
      const f_img_url = api_res.data[randomIndex];
      try{
        const response = await ctx.http.get(f_img_url, {responseType: 'arraybuffer'});
        const buffer = Buffer.from(response);
        return buffer;
      }catch(error){
        if(config.outputLogs === true){
          logger.error('请求最终url时出错:', error);
        }
        console.error('请求最终url时出错:', error);
        return null; // 如果请求出错，返回 null
      }
    }else{
      console.log('API返回无结果,检查自身网络或API可用性', api_res.msg);
      return null;
    }
  } catch (error) {
    console.error('请求 API 时出错:', error);
    return null; // 如果请求出错，返回 null
  }
}

function processId(id, displayFullId) {
  //用于处理id，若传入的displayFullId为false，则将字符串处理后再返回
  if (!displayFullId && id.length > 3) {
    return id.slice(0, 2) + "*".repeat(id.length - 4) + id.slice(-2);
  } else {
    return id;
  }
}

function printLogs(outputLogs, type, log) {
  if (!outputLogs) {
    return;
  }
  if (type == 's') exports.logger.success(log);
  if (type == 'i') exports.logger.info(log);
  return;
}

async function checkWinningCouple(session, ctx, name, rate, group, id, date) {
  //心心相win，每有用户win一次，检查该群是否有人与其赢级之和为99

  let hasWinningCouple = false;
  let result = await ctx.database.get('zvv', {
    month: date[0],
    day: date[1],
    group: group
  }, ['targetId', 'targetName', 'win']);

  for (let i = 0; i < result.length; i++) {
    if (result[i].win + rate == 99 && result[i].targetId != id) {
      //赢级之和为99，且不是自己
      hasWinningCouple = true;
      await session.sendQueued(`恭喜 ${name} 与 ${result[i].targetName} 的赢级之和达到99，实现心心相win！\n愿你们永结同心，在未来的日子里风雨同舟、携手共赢！`, 2 * Time.second);
    }
  }

  if (hasWinningCouple) {
    await session.sendQueued(h.image("https://picst.sunbangyan.cn/2023/12/06/2e884895697639a779f831de37e117ce.jpeg"));
  }
  return;
}

function registerCommand(ctx, config) {
  ctx.command('win', '赢！')
    .action(async ({ session }) => {

      if (isNaN(session.channelId)) {
        await session.sendQueued('独赢赢不如众赢赢，请在群组内使用该指令。');
        return;
      }

      const outputLogs = config.outputLogs;//是否输出日志
      const id = session.userId;//发送者的用户id
      const guild = session.channelId;//发送者所在群组id
      const username = session.username;//发送者的用户名

      const date = await getDate(); //获取当前日期，数组下标0为月份，1为日期，2为小时
      const isExists = await isTargetIdExists(ctx, id, guild); //该群中的该用户是否赢过
      if (isExists) { //若该群中的该用户存在，则获取其上一次赢的日期
        let last = await ctx.database.get('zvv', { targetId: id, group: guild }, ['month', 'day', 'win']); //获取用户id上一次赢的日期

        let lastWin = transform(last);

        //let newWin = true;//标识是否今日刚赢
        if (lastWin[0] == date[0] && lastWin[1] == date[1] && lastWin[2] > 0) { //日期为今日日期，且赢级大于0，说明今日已经赢过
          //newWin = false;
          let rate = lastWin[2];

          //若win的程度是微赢，则共同富win，返回当前win值以更新表
          if (rate <= 2) {
            let temp = await CommonProsperity(ctx, session, rate);//temp[0]即被帮扶者当前win值，temp[1]即榜一id
            if (temp[0] == -1) {
              //返回-1说明榜一大赢未至，无力帮扶
              return;
            }
            //更新被帮扶者信息
            printLogs(outputLogs, 's', `Set a new row in zvv table because id: ${id} in the group: ${guild} in date: ${date[0]}-${date[1]} has enjoyed the fruits of common prosperity, nowWin: ${temp[0]}. `);
            await ctx.database.set('zvv', { targetId: id, group: guild }, {
              targetName: username,
              month: date[0],
              day: date[1],
              win: temp[0],
              winLater: true
            });
            //更新榜一信息
            printLogs(outputLogs, 's', `Set a new row in zvv table because id: ${temp[1]} in the group: ${guild} in date: ${date[0]}-${date[1]} has win-win with ${id}. `);
            await ctx.database.set('zvv', { targetId: temp[1], group: guild }, {
              winLater: true
            });
            return;
          }

          await ctx.database.set('zvv', { targetId: id, group: guild }, {
            targetName: username
          });//更新用户名
          let win = await getWin(rate);//与win的结果所对应的下标
          await session.sendQueued(await getInterpret(date, username, false, win, rate, false, false), 2 * Time.second);
        }
        else {//用户存在且今日未赢，则做更新
          let winLevel = 0;
          let rate = await getRandom();//这里的rate是被抽到的随机数，下面的win则代表赢的结果
          let tempBlowed = false;//用于临时标记用户是否乘过风口

          if (date[2] == windWindow && !hasBlowed.includes(guild)) {//如果某用户win的所在时间恰好是“风口”，且该风口内还没有人win，则赢级加40%
            rate = (rate + 40 > 100) ? 100 : (rate + 40);
            hasBlowed.push(guild);//将该群组加入hasBlowed数组，说明该群组内已经有人乘过风口了
            tempBlowed = true;//临时标记
          }

          let hasTargetedWinAssist = false;//用于标记是否被精准帮扶过
          //查出小赢的天数
          let temp = await ctx.database.get('zvv', { targetId: id, group: guild }, 'miniWinDays');
          let miniWin = 0;
          temp.forEach((item) => {
            miniWin = item.miniWinDays;
          });
          if (miniWin >= 3 && !tempBlowed) {//若连续小赢超过3天，且当日没有乘上风口，则在当日赢级的基础上加40%
            let temp = rate + 40;
            rate = temp > 100 ? 100 : temp;
            printLogs(outputLogs, 'i', `Id: ${id} in the group: ${guild} has mini-wined ${miniWin} days, so today his win will be ${rate}. `);
            await ctx.database.set('zvv', { targetId: id, group: guild }, {
              miniWinDays: 0, //重置天数
            });
            hasTargetedWinAssist = true;
          }

          winLevel = await (getWin(rate)); //获取赢的结果
          printLogs(outputLogs, 's', `Set a new row in zvv table because isExists = ${isExists} and lastWin = ${lastWin[0]}-${lastWin[1]}. id: ${id}, group: ${session.guildId}, date: ${date[0]}-${date[1]}, rate: ${rate}. `);
          await ctx.database.set('zvv', { targetId: id, group: guild }, {
            targetName: username,
            month: date[0],
            day: date[1],
            win: rate,
            winLater: false
          });//更新数据，小赢天数则在前后单独计算

          if (winLevel == 1) {//如果赢的程度是小赢，则将该用户的miniWinDays字段加1，其中也包括受帮扶后的小赢
            await ctx.database.set('zvv', { targetId: id, group: guild }, {
              miniWinDays: { $add: [{ $: 'miniWinDays' }, 1] }
            });
          } else { //否则归零
            await ctx.database.set('zvv', { targetId: id, group: guild }, {
              miniWinDays: 0
            });
          }

          await session.sendQueued(await getInterpret(date, username, true, winLevel, rate, hasTargetedWinAssist, tempBlowed), 2 * Time.second); //解读赢的结果并发送至消息队列
          checkWinningCouple(session, ctx, username, rate, guild, id, date);
          return;
        }
      }
      else { //用户不存在，在表中插入一行
        let winLevel = 0;
        let rate = await getRandom();
        let tempBlowed = false;//用于临时标记用户是否乘过风口
        if (date[2] == windWindow && !hasBlowed.includes(guild)) {//如果某用户win的所在时间恰好是“风口”，且该风口内还没有人win，则赢级加40%
          rate = (rate + 40 > 100) ? 100 : (rate + 40);
          hasBlowed.push(guild);//将该群组加入hasBlowed数组，说明该群组内已经有人乘过风口了
          tempBlowed = true;//临时标记
        }
        winLevel = await (getWin(rate)); //获取赢的结果
        printLogs(outputLogs, 's', `Create a new row in zvv table because isExists = ${isExists}. id: ${id}, group: ${guild}, date: ${date[0]}-${date[1]}, rate: ${rate}.`);
        await ctx.database.create('zvv', {
          targetId: id,
          targetName: username,
          month: date[0],
          day: date[1],
          win: rate,
          group: guild,
          winLater: false,
          miniWinDays: (winLevel == 1) ? 1 : 0
        });
        await session.sendQueued(await getInterpret(date, username, true, winLevel, rate, false, tempBlowed), 2 * Time.second);
        checkWinningCouple(session, ctx, username, rate, guild, id, date);
        return;
      }
    });

  ctx.command('rank', '查看当前群win情况的排行')
    .option('statistics', '-s 展示本群赢级的统计信息')
    .option('all', '-a 展示本群全部赢级的排行')
    .action(async ({ session, options }) => {
      //需先查出该群当天赢的人数
      const date = await getDate(); //获取当前日期，数组下标0为月份，1为日期
      const guildId = session.channelId; //群号
      const guildName = session.channelName; //群名

      let result = await ctx.database.get('zvv', {
        month: date[0],
        day: date[1],
        group: guildId
      }, ['targetId', 'targetName', 'win', 'winLater']); //查出的内容包括用户账号及赢的程度，以及是否受过帮扶

      result = result.filter(item => item.win > 0); //去掉所有win值小于等于0的情况

      if (result.length === 0) {
        await session.sendQueued('本群今日还没有人赢，请在至少一人赢过后再试。');
        return;
      }

      const displayFullId = config.displayFullId;
      //console.log(displayFullId);
      let newArr = [];
      result.forEach((item) => {
        let tempArr = [];
        tempArr[0] = processId(item.targetId, displayFullId);
        tempArr[1] = item.targetName;
        tempArr[2] = item.win;
        tempArr[3] = item.winLater;
        newArr.push(tempArr);
      }); //将查出的结果存入newArr数组
      newArr.sort((a, b) => b[2] - a[2]); //定义以按win降序排列的方式排序
      //let newArr = getTodayWinList(ctx, session);

      if (options.statistics) {
        /*查看更详细的统计数据，此时今日赢的情况已降序存储于newArr中
          统计最大值（Maximum Value）、最小值（Minimum Value）、平均值（Average）、
          中位数（Median）、极差（Range）、方差（Variance）、标准差（Standard Deviation）
        */

        //从newArr中单独提取win结果
        const winValues = newArr.map(item => item[2]);

        // 平均值
        const sum = winValues.reduce((acc, val) => acc + val, 0);
        const averageValue = sum / winValues.length;

        // 中位数
        const sortedValues = winValues.sort((a, b) => a - b);
        const middleIndex = Math.floor(sortedValues.length / 2);
        const medianValue = sortedValues.length % 2 === 0 ? (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2 : sortedValues[middleIndex];

        // 极差
        const rangeValue = winValues[newArr.length - 1] - winValues[0];

        // 方差
        const squaredDifferences = winValues.map(val => Math.pow(val - averageValue, 2));
        const varianceValue = squaredDifferences.reduce((acc, val) => acc + val, 0) / winValues.length;

        // 标准差
        const standardDeviationValue = Math.sqrt(varianceValue);

        //今日win人数
        const toll = newArr.length;

        const output = `${guildName}（${processId(guildId, displayFullId)}）今日共有${toll}人赢了。\n` +
          `其中，赢级最高者是：${newArr[0][1]}（${newArr[0][0]})，其赢级为${newArr[0][2]}%；\n` +
          `最低者是：${newArr[toll - 1][1]}（${newArr[toll - 1][0]})，其赢级为${newArr[toll - 1][2]}%。\n` +
          `本群今日总win值的平均值为${averageValue.toFixed(2)}，中位数为${medianValue}，极差为${rangeValue}，方差为${varianceValue.toFixed(2)}，标准差为${standardDeviationValue.toFixed(2)}。`;

        await session.sendQueued(output);
        return;
      }

      if (options.all) {
        //展示全部排行
        let output = guildName + '（' + processId(guildId, displayFullId) + '）今日完整的赢级排行如下：\n';
        let ranking = 1;
        newArr.forEach((item) => {
          let winLater = '';
          if (item[3]) winLater += '（共赢）';
          output += ' - ' + ranking + ': ' + item[1] + '（' + item[0] + '） ' + item[2] + '%' + winLater + '\n';
          ranking++;
        });
        await session.sendQueued(output, 5 * Time.second);
        return;
      }

      //无选项时，仅展示前5名
      let output = '';
      let ranking = 1;
      if (newArr.length > 5) {
        output += guildName + '（' + processId(guildId, displayFullId) + '）' + '今日共有' + newArr.length + '人赢了，其前5名的赢级如下：\n'
        newArr.slice(0, 5).forEach((item) => {
          output += ' - ' + ranking + ': ' + item[1] + '（' + item[0] + '） ' + item[2] + '% \n';
          ranking++;
        });
        output += '……\n可使用选项-a或--all查看完整排行，以及选项-s或--statistics查看统计信息。'
      } else {
        output = guildName + '（' + processId(guildId, displayFullId) + '）' + '今日共有' + newArr.length +'人赢了，其赢级如下：\n';
        newArr.forEach((item) => {
          output += ' - ' + ranking + ': ' + item[1] + '（' + item[0] + '） ' + item[2] + '% \n';
          ranking++;
        });
        output += '\n可使用选项-s或--statistics查看统计信息。';
      }
      
      await session.sendQueued(output, 5 * Time.second);
    });

  ctx.command('ask [...arg]')
    .alias('评价')
    .action(async ({ session }, ...arg) => {
      //传入一个事件，获取张教授对该事件的评价
      let something = '';
      something += (arg === undefined) ? '' : arg.join(' ');    
      let cmt = '';
      let rvwr = '';//评论者
        try {
          const randomLine = getRandomLineFromFile(`${config.sayingsUrl}`);
          rvwr += '张教授';
          cmt += randomLine;
          if (something == '') session.sendQueued(rvwr + '的评价是：' + cmt, 1 * Time.second);
          else session.sendQueued(rvwr + '对' + something + '的评价是：' + cmt, 1 * Time.second);
          if(config.sendImg === true){
            try{
              // 根据张教授评价内容，组合apiurl
              const apiUrl = `https://api.zvv.quest/search?q=${encodeURIComponent(randomLine)}&n=${config.searchNum}`;
              // 从api请求到图片buffer并发送
              const img_buffer = await fetchImageUrls(apiUrl, ctx, config);
              await session.send(h.image(img_buffer, "image/png"));
              }catch(error){
                if(config.outputLogs === true){
                  logger.error('获取图片出错',error);
                }
                console.log('获取图片出错',error);
              }
          }
        } catch(error) {
          await session.send("张教授突然不想评价了，请开启调试模式查看原因");
          if(config.outputLogs === true){
            logger.error('获取图片出错',error);
          }
          console.log("评价出错",error);
        }
        return;
    });


  ctx.command('win.clear', { authority: 5 })
    .action(async ({ session }) => {
      // 清除该群当日赢级
      const date = await getDate(); // 获取当前日期，数组下标0为月份，1为日期
      const guildId = session.guildId; // 群号

      // 将赢级大于2、小于等于50的小赢者的小赢天数减去1
      await ctx.database.set('zvv', {
        month: date[0],
        day: date[1],
        group: guildId,
        win: { $gt: 2, $lte: 50 }
      }, (row) => ({
        miniWinDays: { $add: [{ $: 'miniWinDays' }, -1] }
      }))
      // 然后将当日该群所有用户的赢级更改为-100
      await ctx.database.set('zvv', {
        month: date[0],
        day: date[1],
        group: guildId
      }, {
        win: -100,
        winLater: false,
      });
      printLogs(config.outputLogs, 's', 'Cleared all win-levels in this group today.');
      await session.sendQueued('本群今日所有用户的赢级已清空。', 5 * Time.second);
      return;
    });

  ctx.command('win.help')
    .action(async ({ session }) => {
      // 内置帮助
      let help = '';
      help += 'win插件内置了如下功能：\n';
      help += '- 每日一win：每日一win，看看自己今天有多赢；\n';
      help += '- 共同富win：若用户抽中“灵活赢”，且当日榜一赢级为大赢以上，则再执行一次win指令，即可与榜一共赢；\n';
      help += '- 精准扶win：若用户连续3天抽中小赢，则在第4天的赢级提高40%；\n';
      help += '- 风口飞win：每日在9-21时中，随机抽取一小时作为风口，在风口时间内的首位win者可提高40%赢级。\n';
      help += '- 心心相win：若用户当日赢级与群中其他群友之和为99，则触发教授的祝福。\n';
      help += '可使用rank指令查看当日该群赢级排行，使用ask指令获取张教授对事物的评价。\n';
      help += '更多使用说明请参看本插件的readme文件；遇到问题请在Koishi论坛的5378号帖子内反馈。';
      session.sendQueued(help);
      return;
    });

  ctx.command('win.window', { authority: 3 })
    .alias('查看风口')
    .action(async ({ session }) => {
      // 更新或查看当前风口
      await session.sendQueued('当前风口值详见日志。');
      if (windWindow == -1) {//因为某些原因，错过了窗口的生成
        const randomHour = Math.floor(Math.random() * 13) + 9;
        //const randomHour = temp;
        exports.logger.success('The wind-window today was not generated, and has been set to ' + randomHour + '; The array hasBlowed has been cleaned as well.');
        windWindow = randomHour;
        hasBlowed = [];
        return;
      }
      let outputHasBlowed = '';
      if (hasBlowed.length == 0) outputHasBlowed = 'empty.';
      else outputHasBlowed = hasBlowed.join(', ') + '.';
      exports.logger.info('The wind-window today is ' + windWindow + ', and the hasBlowed array is ' + outputHasBlowed);
      return;
    });
}
