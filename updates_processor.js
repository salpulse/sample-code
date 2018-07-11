import { Meteor } from 'meteor/meteor';
import { UpdatesDigest } from '../imports/api/updates_digest';
import { Users } from '../imports/api/users';
import { Feeds } from '../imports/api/feeds';
import { CCElements } from '../imports/api/cc_elements';
import { Organisations } from '../imports/api/organisations';
import { Email } from 'meteor/email';

import SyncedCron from '../imports/contrib/meteor-synced-cron/server/synced-cron-server';

import PathHelpers from '../imports/helpers/server/paths';
import AuthenticationHelpers from '../imports/helpers/authentication';
import StringHelpers from '../imports/helpers/strings';

import { getUserState, getResetToken } from '../imports/helpers/server/users';

import '../imports/contrib/simonhochrein_mjml';

var moment = require('moment'); // For date arithmatic
var upRunning = false; // Only ever allow one update processor to start and run

// This class sends the periodical digest update of new stories and recognitions
// to each user
export class UpdatesProcessor {
  static startup() {
    // This should only ever be run once, during server startup
    if (upRunning) {
      return;
    } else {
      upRunning = true;
    }

    const updatesProcessor = new UpdatesProcessor();

    // SyncedCron is from https://github.com/percolatestudio/meteor-synced-cron
    // Note: a new process will not trigger while an old one is running (SyncedCron appears single threaded)
    // so no need for a busy semaphore
    // SyncedCron logs into Mongo collection 'cronHistory'. Default TTL on logs is 48 hours. using
    // config to modify this doesn't seem to work.
    //
    //  SyncedCron.config() is setup in /imports/contrib...

    SyncedCron.add({
      name: 'UpdatesProcessor.process',
      schedule: laterParser => laterParser.text('at 00:00'), // Every Day UTC time, 10am AET
      job: () => {
        updatesProcessor._process();
      },
    });

    SyncedCron.start();
  }

  constructor() {
    this.ITEM_TRIM_LENGTH_PRIMARY = 500; // Characters
    this.ITEM_TRIM_LENGTH_SECONDARY = 250; // Characters
  }

  _process() {
    const endDateWindow = new Date();
    const startDateWindow = UpdatesDigest.getAndSetLastSentAt(endDateWindow);
    if (!startDateWindow) {
      // Skip this cycle as we have no starting date in the database
      return;
    }

    // console.log(`Date window: ${startDateWindow} -- ${endDateWindow}`);
    const orgs = Organisations.findOrganisationsAll().fetch();
    orgs.forEach(org => {
      const feedsInDateWindow = Feeds.findFeedsInDateWindow(org._id, startDateWindow, endDateWindow).fetch();

      if (feedsInDateWindow.length === 0) {
        console.log(`No Updates for ${org.name}`);
        return; // Skip to next org
      }

      if (org.name === 'DEMO') {
        console.log(`Skipping ${feedsInDateWindow.length} feeds to update for ${org.name} (DEMO org)`);
        return; // Skip to next org
      }
      console.log(`${feedsInDateWindow.length} feeds to update for ${org.name}`);
      const users = Users.findUserIdsAllInOrg(org._id).fetch();
      users.forEach(user => {
        let feedsListToUpdate = [];
        feedsInDateWindow.forEach(feed => {
          // If this user is the author, or a recipient (in the case of a Recognition
          // or has already been notified
          // via the notifications digest (or a notification is pending),
          // don't add this feed item to the update
          if (
            feed.authorId != user._id &&
            !('mentionsIds' in feed && feed.mentionsIds.includes(user._id)) &&
            !(feed.feedType === 'Recognition' && feed.recipientIds.includes(user._id))
          ) {
            feedsListToUpdate.push(feed);
          }
        });
        if (feedsListToUpdate.length > 0) {
          this._send(user._id, org, feedsListToUpdate);
        }
      });
    });
  }

  _send(recipientId, organisation, feedsListToUpdate) {
    const recipient = Meteor.users.findOne(recipientId);
    const URLRoot = PathHelpers.buildURLRoot(recipient);
    // Uses Meteor/Handlebars/MJML(Mailjet Markup Language - for writing
    //  responsive HTML emails) wrapper from
    // https://github.com/simonhochrein/meteor-mjml

    // Prepare the data for plugging into the template
    let data = {};
    data.logo = `${Meteor.absoluteUrl()}images/Salpulse-Logo-Email.jpg`;
    data.organisation = StringHelpers.trimWithElipses(organisation.name, 50);
    data.organisationPossessive = `${organisation.name}\'${organisation.name.endsWith('s') ? '' : 's'}`;
    data.appLink = PathHelpers.completeURL(URLRoot, '/');
    data.recipient = { firstName: recipient.profile.firstName, lastName: recipient.profile.lastName };
    data.feeds = feedsListToUpdate.map(feed =>
      this._getFeedItemData(recipientId, feed, organisation._id, URLRoot),
    );
    // console.log(StringHelpers.prettyPrintableObject(data, '_send()'));

    // Injest the template
    let email = new MJML(`${PathHelpers.getAssetPath()}/email_templates/update.mjml`);

    // Wire up the data to the template
    email.helpers(data);

    // Handlebars = Npm.require('handlebars');
    // const output = Handlebars.compile(email.mjml)(data);
    // console.log('Handlebars compilation\n' + output + '\n');
    // console.log('MJML compilation\n' + email.compile() + '\n');

    // Now send the HTML email

    const to = `${recipient.profile.firstName} ${recipient.profile.lastName} <${
      recipient.emails[0].address
    }>`;

    email.send({
      to: to,
      from: `${Meteor.isDevelopment ? 'TEST ' : ''}Salpulse <notifications@salpulse.com>`,
      subject: `${Meteor.isDevelopment ? 'TEST ' : ''}What's been happening on Salpulse`,
    });

    console.log(`Update to ${to}`);
  }

  _getFeedItemData(recipientId, feedItem, orgId, URLRoot) {
    const ccElement = CCElements.findOne(feedItem.ccElementId);
    const author = Meteor.users.findOne(feedItem.authorId);
    let data = {
      author: `${author.profile.firstName} ${author.profile.lastName}`,
      narrative: CCElements.getNarrativePrintable(ccElement),
    };
    if (feedItem.feedType === 'Story') {
      data.isStory = true;
      if ('story' in feedItem && feedItem.story.length > 0) {
        data.content = StringHelpers.trimWithElipses(
          StringHelpers.compileMarkup(feedItem.story),
          this.ITEM_TRIM_LENGTH_PRIMARY,
        );
      }
    } else {
      // Recognition
      data.isRecognition = true;
      if ('note' in feedItem && feedItem.note.length > 0) {
        data.content = StringHelpers.trimWithElipses(
          StringHelpers.compileMarkup(feedItem.note),
          this.ITEM_TRIM_LENGTH_PRIMARY,
        );
      }
      const recognitionRecipients = Users.findUserFullNameAllInOrg(orgId, feedItem.recipientIds).fetch();
      data.recognitionRecipients = StringHelpers.commaListOfNamesPlain(recognitionRecipients, recipientId);
    }
    data.link = PathHelpers.completeURL(URLRoot, `/feed/${ccElement._id}/${feedItem._id}`);
    return data;
  }
}

Meteor.methods({
  // For testing purposes only. This will typically be cron'd
  // NB: This is not thread safe - designed for testing only
  'updatesProcessor.run'() {
    if (!Meteor.userId()) {
      throw new Meteor.Error(403, 'You must be logged in to perform this function');
    }
    if (!AuthenticationHelpers.doIHaveAuthority(['super-admin'])) {
      throw new Meteor.Error(403, 'Not authorised to perform this method');
    }
    if (Meteor.isServer) {
      console.log('Manual trigger of UpdatesProcessor');
      up = new UpdatesProcessor();
      up._process();
    }
  },
});
