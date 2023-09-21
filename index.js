const puppeteer = require('puppeteer');
const {parseISO, compareAsc, isBefore, format} = require('date-fns')
require('dotenv').config();

const {delay, logStep, sendHomeAssistantNotification} = require('./utils');
const {siteInfo, loginCred, IS_PROD, NEXT_SCHEDULE_POLL} = require('./config');

let isLoggedIn = false;
let latestDate = undefined;

const login = async (page) => {
  logStep('logging in');
  await page.goto(siteInfo.LOGIN_URL);

  const form = await page.$("form#sign_in_form");

  const email = await form.$('input[name="user[email]"]');
  const password = await form.$('input[name="user[password]"]');
  const privacyTerms = await form.$('input[name="policy_confirmed"]');
  const signInButton = await form.$('input[name="commit"]');

  await email.type(loginCred.EMAIL);
  await password.type(loginCred.PASSWORD);
  await privacyTerms.click();
  await signInButton.click();

  await page.waitForNavigation();

  return true;
}

const notifyMe = async (earliestDate) => {
  const formattedDate = format(earliestDate, 'MM/dd/yyyy');
  logStep(`sending an email to schedule for ${formattedDate}`);
  if(formattedDate !== latestDate){
	sendHomeAssistantNotification(formattedDate).then(() => latestDate = formattedDate);
	}
}

const checkCurrentScheduleDate = async (page) => {
	await page.setExtraHTTPHeaders({
    	'Accept': 'application/json, text/javascript, */*; q=0.01',
    	'X-Requested-With': 'XMLHttpRequest'
  	});
	await page.goto(siteInfo.HOME_URL);

	
	const dateText = await page.evaluate(() => {
		return document.querySelector(".consular-appt").textContent
	})
	const appointmentDate = dateText.split(':')[1].split(',').splice(0, 2).join();
	const isoDate = new Date(appointmentDate.trim()).toISOString().split('T')[0]

	logStep(`Current appointment: ${isoDate}`)

	return isoDate;
}

const reschedule = async (page, date) => {
	await page.setExtraHTTPHeaders({
    	'Accept': 'application/json, text/javascript, */*; q=0.01',
    	'X-Requested-With': 'XMLHttpRequest'
  	});
	await page.goto(siteInfo.RESCHEDULE_URL);
	
	const form = await page.$("form#appointment-form");

	const facilityId = await form.$('select[name="appointments[consulate_appointment][facility_id]"]');
	const appointmentDate = await form.$('select[name="appointments[consulate_appointment][date]"]');
	const appointmentTime = await form.$('select[name="appointments[consulate_appointment][time]"]');
	const rescheduleButton = await form.$('input[name="commit"]');

	await facilityId.type(siteInfo.FACILITY_ID);
	await appointmentDate.type(date);
	const fistTimeOption = await page.$$eval('select[name="appointments[consulate_appointment][time]"]', all => all.map(a => a.textContent))[0]
	await appointmentTime.type(fistTimeOption);
	await rescheduleButton.click();

	await page.waitForNavigation();

	return true;
	
}

const checkForSchedules = async (page) => {
  logStep('checking for schedules');
  await page.setExtraHTTPHeaders({
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
  });
  await page.goto(siteInfo.APPOINTMENTS_JSON_URL);

  const originalPageContent = await page.content();
  const bodyText = await page.evaluate(() => {
    return document.querySelector('body').innerText
  });

  try{
    const parsedBody =  JSON.parse(bodyText);

    if(!Array.isArray(parsedBody)) {
      throw "Failed to parse dates, probably because you are not logged in";
    }

    const dates =parsedBody.map(item => parseISO(item.date));
    const [earliest] = dates.sort(compareAsc)

    return earliest;
  }catch(err){
    console.log("Unable to parse page JSON content", originalPageContent);
    console.error(err)
    isLoggedIn = false;
  }
}


const process = async (browser) => {

  const page = await browser.newPage();

  if(!isLoggedIn) {
     isLoggedIn = await login(page);
  }

  const currentDate = await checkCurrentScheduleDate(page);
  const earliestDate = await checkForSchedules(page);
  if(earliestDate && isBefore(earliestDate, parseISO(currentDate))){
    await notifyMe(earliestDate);
  }

  await delay(NEXT_SCHEDULE_POLL)

  await process(browser)
}


(async () => {
  const browser = await puppeteer.launch(!IS_PROD ? {headless: false, executablePath: '/usr/bin/chromium-browser'}: undefined);

  try{
    await process(browser);
  }catch(err){
    console.error(err);
  }

  await browser.close();
})();
