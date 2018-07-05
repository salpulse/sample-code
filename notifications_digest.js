import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { merge } from 'lodash';

import SimpleSchema from 'simpl-schema';
import { Comments } from './comments';
import { Feeds } from './feeds';

if (Meteor.isServer) {
  class NotificationsDigestApi extends Mongo.Collection {
    constructor() {
      super('notifications_digest');

      this.schema = new SimpleSchema({
        userId: SimpleSchema.RegEx.Id,
        orgId: SimpleSchema.RegEx.Id,
        notificationCount: Number, // Denormalised
        newRecognitions: [Object],
        'newRecognitions.$.feedItemId': [SimpleSchema.RegEx.Id],
        'newRecognitions.$.authorId': [SimpleSchema.RegEx.Id],
        newComments: [Object],
        'newComments.$.commentId': [SimpleSchema.RegEx.Id],
        'newComments.$.authorId': [SimpleSchema.RegEx.Id],
        'newComments.$.feedItemId': [SimpleSchema.RegEx.Id],
        newLikesFeedItem: [Object],
        'newLikesFeedItem.$.likerId': [SimpleSchema.RegEx.Id],
        'newLikesFeedItem.$.feedItemId': [SimpleSchema.RegEx.Id],
        newLikesComment: [Object],
        'newLikesComment.$.likerId': [SimpleSchema.RegEx.Id],
        'newLikesComment.$.commentId': [SimpleSchema.RegEx.Id],
        'newLikesComment.$.feedItemId': [SimpleSchema.RegEx.Id],
        newMentionsFeedItem: [Object],
        'newMentionsFeedItem.$.feedItemId': [SimpleSchema.RegEx.Id],
        'newMentionsFeedItem.$.authorId': [SimpleSchema.RegEx.Id],
        newMentionsComment: [Object],
        'newMentionsComment.$.commentId': [SimpleSchema.RegEx.Id],
        'newMentionsComment.$.authorId': [SimpleSchema.RegEx.Id],
        'newMentionsComment.$.feedItemId': [SimpleSchema.RegEx.Id],
        busy: Boolean,
        triggerAt: Date,
      });
    }

    // Helper functions
    _randomIntFromInterval(min, max) {
      return Math.floor(Math.random() * (max - min + 1) + min);
    }

    _checkArgRecipientsIds(recipientIds, caller) {
      if (!(recipientIds instanceof Array)) {
        throw new Meteor.Error(
          'NotificationsDigestApi error',
          `recipientIds must be an array in ${caller}()`,
        );
      }
    }

    _doDigestUpdatesWithInc(recipientIds, orgId, updateSpec, triggerNow = false) {
      let newUpdateSpec = merge(
        {
          $inc: { notificationCount: 1 },
        },
        updateSpec,
      );
      if (triggerNow) {
        newUpdateSpec = merge(
          {
            $set: { triggerAt: new Date() },
          },
          newUpdateSpec,
        );
      }

      recipientIds.forEach(recipient => {
        const digestId = this._getDigestIdForUser(recipient, orgId);

        // Grab the MUTEX
        this.lock(digestId, () => {
          // Make the update
          NotificationsDigest.update(digestId, newUpdateSpec);
        });
      });
    }

    _doDigestUpdatesWithDec(recipientIds, orgId, countFunction, updateSpec) {
      recipientIds.forEach(recipient => {
        const digestId = this._getDigestIdForUser(recipient, orgId);

        // Grab the MUTEX
        this.lock(digestId, () => {
          const countItemsThatWillBeRemoved = countFunction(digestId);
          let newUpdateSpec = merge(
            {
              $inc: { notificationCount: -countItemsThatWillBeRemoved },
            },
            updateSpec,
          );

          // Make the update
          NotificationsDigest.update(digestId, newUpdateSpec);
        });
      });
    }

    /** Mutex implementation for NotificationsDigest document
     *  Backs off up to 100 times for 100-200ms per time if it cannot get the lock
     *  @param {String} _id - ID of the NotificationsDigest document to lock
     *  @param {Function} workTodo - What to do when the lock is obtained
     *  @param {Function} attemptNumber - How many times we've attempted to get the lock
     */
    lock(_id, workTodo, attemptNumber = 1) {
      if (typeof workTodo !== 'function') {
        throw new Meteor.Error(405, 'lock must take a function argument');
      }
      let workError = undefined;
      // findAndModify is a Raw mongo op that has been wrapped
      // by the package https://github.com/fongandrew/meteor-find-and-modify
      // console.log(`lock(${_id})`);
      const result = NotificationsDigest.findAndModify({
        query: { _id },
        update: { $set: { busy: true } },
        upsert: true,
      });

      // result ==  null if document did not exist prior to findAndModify()
      //        ==  original document (prior to upsert) if document already existed
      if (result && result.busy) {
        //  mutex is already taken by someone else, so backoff and try again if we haven't outlived our welcome
        if (attemptNumber >= 100) {
          // Approx. 15 second timeout
          throw new Meteor.Error(405, 'mutex lock request expired');
        }
        const delay = this._randomIntFromInterval(100, 200);
        console.log(`${attemptNumber} ${delay}`);
        Meteor.setTimeout(this.lock.bind(this, _id, workTodo, attemptNumber + 1), delay);
        return;
      }
      // We now have the mutex, so execute the payload
      try {
        workTodo();
      } catch (error) {
        workError = error;
      } finally {
        // Finished all the work, so release the mutex
        const result = NotificationsDigest.findAndModify({
          query: { _id },
          update: { $set: { busy: false } },
          upsert: true,
        });
        if (!result) {
          throw new Meteor.Error(405, 'mutex could not be unlocked');
        }
      }
      // If there were any payload execution errors, now it's safe to release them to the caller
      // since we are outside the mutex
      if (workError) {
        throw new Meteor.Error(405, workError);
      }
    }

    _getDigestIdForUser(userId, orgId) {
      // This operation must be atomic to avoid a race condition with other clients trying to
      // create a NotificationDigest document for the same user/Org. Hence it uses findAndModify
      // with a unique index on the userId/OrgId fields, instead of separate find() and insert() calls
      // at the application level.
      // console.log(`_getDigestIdForUser(${userId})`);
      const digest = NotificationsDigest.findAndModify({
        query: { userId, orgId },
        update: { $setOnInsert: { triggerAt: new Date(), notificationCount: 0 } },
        upsert: true,
        new: true, // Return the found document or the newly created one
        fields: { _id: 1 },
      });
      return digest._id;
    }

    // API functions
    addNewComment(recipientIds, commentId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewComment');

      const comment = Comments.findOne(
        { _id: commentId },
        { fields: { _id: 1, orgId: 1, feedItemId: 1, authorId: 1 } },
      );
      this._doDigestUpdatesWithInc(recipientIds, comment.orgId, {
        $push: {
          newComments: {
            commentId,
            authorId: comment.authorId,
            feedItemId: comment.feedItemId,
          },
        },
        // $inc: { quantity: 1, notificationCount: 1 },
      });
    }

    addNewLikeFeedItem(recipientIds, feedItemId, likerId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewLikeFeedItem');
      const feedItem = Feeds.findOne({ _id: feedItemId }, { fields: { orgId: 1 } });
      this._doDigestUpdatesWithInc(recipientIds, feedItem.orgId, {
        // Note: this can push a duplicate if the user toggles like/unlike very rapidly
        // multiple times. Tried using $addToSet, but this stuffs up the notificationCount
        // So instead, dedup the array on consumption
        $push: {
          newLikesFeedItem: {
            feedItemId,
            likerId,
          },
        },
      });
    }

    removeLikeFeedItem(recipientIds, feedItemId, likerId) {
      this._checkArgRecipientsIds(recipientIds, 'removeLikeFeedItem');
      const feedItem = Feeds.findOne({ _id: feedItemId }, { fields: { orgId: 1 } });
      this._doDigestUpdatesWithDec(
        recipientIds,
        feedItem.orgId,
        digestId => {
          const digest = NotificationsDigest.findOne({ _id: digestId }, { fields: { newLikesFeedItem: 1 } });
          if ('newLikesFeedItem' in digest) {
            return digest.newLikesFeedItem.filter(
              newLikeFeedItem =>
                newLikeFeedItem.feedItemId === feedItemId && newLikeFeedItem.likerId == likerId,
            ).length;
          } else {
            return 0;
          }
        },
        {
          // If the like item exists in the digest, rip it out. It might not
          // though if the notification has already been sent to the feed item author
          $pull: {
            newLikesFeedItem: {
              feedItemId,
              likerId,
            },
          },
        },
      );
    }

    addNewLikeComment(recipientIds, commentId, likerId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewLikeComment');
      const comment = Comments.findOne({ _id: commentId }, { fields: { _id: 1, feedItemId: 1, orgId: 1 } });
      this._doDigestUpdatesWithInc(recipientIds, comment.orgId, {
        // Note: this can push a duplicate if the user toggles like/unlike very rapidly
        // multiple times. Tried using $addToSet, but this stuffs up the notificationCount
        // So instead, dedup the array on consumption
        $push: {
          newLikesComment: {
            commentId,
            likerId,
            feedItemId: comment.feedItemId,
          },
        },
      });
    }

    removeLikeComment(recipientIds, commentId, likerId) {
      this._checkArgRecipientsIds(recipientIds, 'removeLikeComment');
      const comment = Comments.findOne({ _id: commentId }, { fields: { _id: 1, feedItemId: 1, orgId: 1 } });
      this._doDigestUpdatesWithDec(
        recipientIds,
        comment.orgId,
        digestId => {
          const digest = NotificationsDigest.findOne({ _id: digestId }, { fields: { newLikesComment: 1 } });
          if ('newLikesComment' in digest) {
            return digest.newLikesComment.filter(
              newLikeComment => newLikeComment.commentId === commentId && newLikeComment.likerId == likerId,
            ).length;
          } else {
            return 0;
          }
        },
        {
          // If the like item exists in the digest, rip it out. It might not
          // though if the notification has already been sent to the feed item author
          $pull: {
            newLikesComment: {
              commentId,
              likerId,
              feedItemId: comment.feedItemId,
            },
          },
        },
      );
    }

    addNewRecognition(recipientIds, feedItemId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewRecognition');

      const feedItem = Feeds.findOne({ _id: feedItemId }, { fields: { _id: 1, authorId: 1, orgId: 1 } });
      this._doDigestUpdatesWithInc(
        recipientIds,
        feedItem.orgId,
        {
          $push: {
            newRecognitions: {
              feedItemId,
              authorId: feedItem.authorId,
            },
          },
        },
        true, // Trigger an immediate send for this type of notification
      );
    }

    addNewMentionInFeedItem(recipientIds, feedItemId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewMentionInFeedItem');

      const feedItem = Feeds.findOne({ _id: feedItemId }, { fields: { _id: 1, authorId: 1, orgId: 1 } });
      this._doDigestUpdatesWithInc(
        recipientIds,
        feedItem.orgId,
        {
          $push: {
            newMentionsFeedItem: {
              feedItemId,
              authorId: feedItem.authorId,
            },
          },
        },
        true, // Trigger an immediate send for this type of notificationon
      );
    }

    addNewMentionInComment(recipientIds, commentId) {
      this._checkArgRecipientsIds(recipientIds, 'addNewMentionInComment');
      const comment = Comments.findOne(
        { _id: commentId },
        { fields: { _id: 1, feedItemId: 1, authorId: 1, orgId: 1 } },
      );

      this._doDigestUpdatesWithInc(
        recipientIds,
        comment.orgId,
        {
          $push: {
            newMentionsComment: {
              commentId,
              authorId: comment.authorId,
              feedItemId: comment.feedItemId,
            },
          },
        },
        true, // Trigger an immediate send for this type of notification
      );
    }
  }

  // Declare the global collection
  export const NotificationsDigest = new NotificationsDigestApi();
}
