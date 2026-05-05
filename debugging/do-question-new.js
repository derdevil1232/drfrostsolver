// Loaded from CDN and included in externals in webpack.config.js
import MathJax from "mathjax";

// Required JS from node_modules
import confetti from "canvas-confetti";

// Required JS from local files
import {
   addInitialFunction,
   Context,
   dfmAlert,
   dfmDialog,
   isStudent,
   isTeacher,
   redirectToRequiredLogin,
} from "./dfm5";
import {
   dfm_generateQuestionContent,
   getAnswerInput,
   insertHTMLAnswer,
   replaceMathsTags
} from "./question-util";
import { closeKeyboard } from "./algebra-1.8";
import {
   clearStrokes,
   clearWhiteboardImg,
   compressStrokes,
   setWhiteboardImg,
   setWhiteboardImgDesmos
} from "./dfm-whiteboard-new";
import { videoSkillHelp } from "./util-videos";
import { getReadFriendlyStatusMessage } from "~/utils/errors";
import {
   posthogEventTaskCompleted,
   posthogEventTaskContinued,
   posthogEventTaskExitedBeforeCompletion,
   posthogEventTaskIndependentPracticeStarted,
   posthogEventTaskSetWorkStarted
} from "~/utils/posthog/tasks";
import { removeQueryParams } from "~/utils/urls";

// CSS
import "./do-question-new.css";
import "./whiteboard-new-temp.css";

let justAnswered;
let fromRevisionHub = false;
let revisionHubReturnLink;

$(document).ready(function(){
   // Determine if we have arrived from the revision hub for a past paper practice session.
   const searchParams = new URLSearchParams(window.location.search);
   fromRevisionHub = searchParams.get("from") === "revision";

   /**
    * If we have arrived from the revision hub, we want to store the link to return to
    * after completing or exiting the task. We store this in session storage for guests
    * and local storage for logged in users. If we have the just-logged-flag, that means
    * they would have been a guest when they navigated away from the revision hub.
    */
   addInitialFunction(() => {
      if (fromRevisionHub) {
         let storedRevisionHubLink;
         if (Context.user) {
            const justLoggedIn = searchParams.get("just-logged-in") === "";
            removeQueryParams(["just-logged-in"]);
            if (justLoggedIn) {
               storedRevisionHubLink = sessionStorage.getItem(`dfRevisionHubLink_guest`);
               sessionStorage.removeItem("dfRevisionHubLink_guest");
            } else {
               storedRevisionHubLink = localStorage.getItem(`dfRevisionHubLink_${Context.user.uid}`);
            }
         } else {
            storedRevisionHubLink = sessionStorage.getItem(`dfRevisionHubLink_guest`);
         }
         revisionHubReturnLink = storedRevisionHubLink || "/revision/papers";
      }
   })

   $("#doquestion-exit-task").on("click", continueLater);
   $("#doquestion-exit-task").html(fromRevisionHub ? "Exit paper" : "Exit task");

   $("#doquestion-difficulty").dfmLevelBar();

   if(preloadState && preloadState.aaid) {
      addInitialFunction(redirectToRequiredLogin);
   }

   addInitialFunction(postLoginInitiate);

   const handleWatchVideo = function(){
      var subskills = [];

      // First check if any directly associated subskill has a video.
      const associatedSubskill = $(document).data("taskState").question?.subskill || {};
      if (associatedSubskill.video) {
         subskills.push(associatedSubskill);
      }

      // Otherwise, use any skills associated with the question.
      const associatedSkills = $(document).data("taskState").question?._skills || [];
      if (subskills.length === 0) {
         associatedSkills.forEach(skill => {
            subskills = subskills.concat(skill.subskills || []);
         });
      }

      videoSkillHelp({
         subskills,
         task: posthogTaskObject,
         attempt: posthogAttemptObject,
      });
   }

   // Bind the Watch Video handler both to clicks, and to Enter presses when the link has focus
   $("#doquestion-question-video").on("click", handleWatchVideo);
   $("#doquestion-question-video").on("keyup", function(event) {
      if (event.key === "Enter") {
         handleWatchVideo();
      }
   });

   var priorWorking = undefined;
   $("#doquestion-whiteboard-main").dfmWhiteboard({
      admin: false,
      control: true,
      resize: true,
      allowImageUpload: false,
      master: false,
      teacher: false,
      fixTextSize: true,
      core : priorWorking,
      uncompress : priorWorking ? true : false
   });
   // $("#doquestion-whiteboard-main").data('control').zoom = 1.5;
   $("#doquestion-whiteboard-main").dfmWhiteboard("instantiateMenu", $("#menu"));

   // Need to conserve space.
   $(".grid-button-super, .text-button, .equation-button").hide();
   $(".erase-menu li").eq(2).remove();

   $("#doquestion-whiteboard-trigger").on("click", openWhiteboard);

   $("#doquestion-whiteboard-actionbutton").on("click", closeWhiteboard);

   $(window).resize();
});

function closeWhiteboard() {
   $("#doquestion-whiteboard").addClass('hide');
   $("#doquestion-whiteboard-trigger").show();
}

function openWhiteboard() {
   $("#doquestion-whiteboard").removeClass('hide');
   $("#doquestion-whiteboard-menucontainer .buttons").hide().delay(300).fadeIn();
   $("#doquestion-whiteboard-trigger").hide();
}

/**
 * Objects for tracking task and attempt data for PostHog events.
 *
 * Updated when loading a question, submitting an answer, pausing
 * or completing a task.
 */
let posthogTaskObject = {};
let posthogAttemptObject = {};

function postLoginInitiate() {
   const searchParams = new URLSearchParams(window.location.search);
   const posthogFrom = searchParams.get("from") || null;

   getTaskQuestion(preloadState ?? {}, 1, {
      setWorkStartedTriggerId: "do-question-start-task",
      taskContinuedTriggerId: {
         "notification-continue": "dashboard-task-continue-notification",
      }[posthogFrom] || "do-question-continue-task",
      pastPaperStartedTriggerId: "revision-hub-start-button"
   }, true);

   /**
    * PostHog event for leaving the page without completing the task.
    *
    * Conditions for event:
    *
    * - User is viewing their own attempt.
    * - Task is not complete.
    */
   window.addEventListener("beforeunload", function () {
      const userIsViewingOwnAttempt = posthogAttemptObject.uid && Context.user?.uid === posthogAttemptObject.uid;
      if (userIsViewingOwnAttempt && !posthogAttemptObject.complete) {
         const posthogTriggerId = continueLaterButtonClicked ? "do-question-continue-later-button" : "do-question-leave-page";
         posthogEventTaskExitedBeforeCompletion({
            triggerId: posthogTriggerId,
            task: posthogTaskObject,
            attempt: posthogAttemptObject,
         });
      }
   });
}

function skipCurrentQuestionDueToRenderingError(aaid, successCallback, errorCallback) {
   $.ajax({
      url: "/api/tasks/advancequestion",
      type: "POST",
      contentType: false,
      processData: false,
      cache: false,
      data: JSON.stringify({ aaid }),
      success: successCallback,
      error: errorCallback
   });
}

function markQuestionAsFailedToRender(aaid, qnum) {
   $.ajax({
      url: "/api/tasks/failedtorender",
      type: "POST",
      contentType: false,
      processData: false,
      cache: false,
      data: JSON.stringify({ aaid, qnum })
   });
}

function getTaskQuestion(options, retryCount = 1, posthogTriggerIds = {}, isInitialLoad = false) {
   console.log("[GetTaskQuestion] options = "+JSON.stringify(options));
   var formData = new FormData();
   lastAnswerWasCorrect = undefined;
   justAnswered = false;
   $("#doquestion-response").hide();
   $.each(options, function(key,val) {
      formData.append(key, val);
   });

   const renderAdvanceQuestionModal = (additionalInformation = null) => {
      dfmAlert(`
         <h4 style="font-size: 18px; margin: 16px 0;">We couldn’t generate this question 🤔</h4>
         <p>There was a problem with this question, but don’t worry — you can advance to the next one.</p>
         ${isStudent() ? "<p>Your teacher will see this noted in your progress record.</p>" : ""}
         <button class="qgen-error-skip-button" style="margin: 12px 0;">Advance to next question</button>
         ${additionalInformation ? `<p style="color: gray; font-size: 12px; padding-top:6px;">${additionalInformation}</p>` : ""}
      `);
      $(".qgen-error-skip-button").on('click', function() {
         $(".close-modal").click();
         skipCurrentQuestionDueToRenderingError(options.aaid,
               function(data) {
                  if (data.isComplete) {
                     // This was the final question of this task - so display the completion pane
                     taskDone({ posthogTriggerId: "do-question-complete-task" });

                     // Update the progress percentage - slightly hacky as we're not going through the whole
                     // qnum bar rendering, but this should definitely say 100%!
                     $("#doquestion-progress-label").html("100%");
                     $("#doquestion-progress-bar").css("width", "100%");
                  }
                  else {
                     // Now we've advanced the task, we can just get the current question for this task
                     getTaskQuestion(options);
                  }
               },
               function (j) {
                  // Well this sucks; no better way to handle this
                  dfmAlert("Unable to advance question: <strong>" + j.responseText + "</strong>");
               }
         );
      })
   }

   var url = "/api/tasks/question/get";
   console.log(url);
   $.ajax({
      url: url,
      type: "POST",
      contentType:false,
      processData: false,
      cache: false,
      data: JSON.stringify(options),
      success: function(data){

         $(document).data("taskState", data);

         // Clear the whiteboard, including any image that may have been set.
         clearStrokes($("#doquestion-whiteboard-main"), 2);
         clearWhiteboardImg($("#doquestion-whiteboard-main"));

         console.log("QUESTION SKILL: "+JSON.stringify(data.question));

         $([document.documentElement, document.body]).animate({
            scrollTop: 0
         }, 500);

         // Show the paper name if we're coming from the revision hub.
         const paperName = data.task?._worksheet?.name;
         if (fromRevisionHub && paperName) {
            $("#doquestion-task-title").html(paperName);
            $("#doquestion-task-title").show();
         } else {
            $("#doquestion-task-title").hide();
         }

         // Show the exit task/paper button if within a task context.
         if (data.task) {
            $("#doquestion-exit-task").show();
         } else {
            $("#doquestion-exit-task").hide();
         }

         if(data.question && data.question.qid) {
            /**
             * If we have an exam question we want to check if we can find
             * a metadata tag and use it as the title of the question.
             *
             * The regex references the main exam boards explicitly. There
             * is too much inconsistency in the database to try anything
             * more general.
             */
            const regex = /\[(amc|aqa|ccea|ctmua|edexcel|eduqas|mat|nzqa|ocr|sqa|wjec)[^\]]*\]/i;
            const match = data.question.content.match(regex);
            const extractedTag = match ? match[0] : null;
            if (extractedTag) {
               data.question.content = data.question.content.replace(regex, '');
               $("#doquestion-question-title").html(extractedTag.slice(1, -1));
            } else {
               $("#doquestion-question-title").html(`Exam question published by ${data.question.authorName}`);
            }

            // We already show a whole paper title if we have come from the revision hub or if we are in a worksheet preview.
            $("#doquestion-question-title").toggle(!fromRevisionHub && !data.worksheet);

            // Difficulty display.
            $("#doquestion-question-difficulty").css("display", "flex");
            $("#doquestion-question-difficulty-bar").empty().html(data.question.difficulty).dfmLevelBar();
            $("#doquestion-question-difficulty-bar").dfmLevelBar("giveColour");

            // Calculator display.
            $("#doquestion-question-calculator").css("display", "flex");
            $("#doquestion-question-calculator-label").html(data.question.calc <= 1 ? "Calculator permitted" : "No calculator allowed");
            $("#doquestion-question-calculator-icon").toggle(data.question.calc <= 1);
         } else if(data.question && data.question.skill && data.question.subskill) {
             if (data.task && data.task.cdata && data.task.cdata.hideskillnames) {
                 $("#doquestion-question-title").hide();
             }
             else {
                 $("#doquestion-question-title").html(`${data.question.skill.publicid}${data.question.subskill.letter} ${data.question.subskill.name}`);
             }
            $("#doquestion-question-difficulty").hide();
            $("#doquestion-question-calculator").hide();
         }

         $("#doquestion-mastery").hide();

         // Video
         const videoAllowed = data.task?.videoAllowed || !data.task;
         const videosAvailable = data.question ? hasVideos(data.question._skills, data.question.subskill) : false;
         const showLinkToVideo = videoAllowed && videosAvailable;
         if (showLinkToVideo) {
            $("#doquestion-question-links").css("display", "flex");
            $("#doquestion-question-video").css("display", "flex");
         } else {
            $("#doquestion-question-links").hide();
            $("#doquestion-question-video").hide();
         }

         // Question
         if(!data.question) {
            data.question = {content: "Sorry, but this question is missing from the worksheet involved in the task. Please click a question number above to skip over this question.",
                 answer: {type: "notanswerable"}};
         }

         var theirAnswer = undefined;
         if (data.attempt && data.attempt.answers[data.qnum] && data.attempt.answers[data.qnum].theiranswer) {
            theirAnswer = data.attempt.answers[data.qnum].theiranswer;
         }

         /**
          * When sending a wid to getTaskQuestion we are treating this as a
          * worksheet "preview mode". We will only get a response when sending
          * a wid that corresponds to a paper in the revision hub and if the
          * request is successful we will have the worksheet object in the
          * response.
          *
          * Tweaks to make to UI for this worksheet preview mode:
          *
          * - Display a "Previewing... " title using the worksheet name.
          * - Display additional question navigation links.
          * - Display an exit preview button.
          * - Use a specific submit handler to show a login or register modal.
          */
         if (data.worksheet) {
            $("#doquestion-task-title").html(`Previewing ${data.worksheet.name || "worksheet"}`);
            $("#doquestion-task-title").show();

            // Display the preview container.
            $("#doquestion-question-preview-container").css("display", "flex");

            // Previous and next question navigation.
            $("#doquestion-question-preview-previous").off("click");
            const previousEnabled = data.qnum > 1;
            $("#doquestion-question-preview-previous").attr("data-state", previousEnabled ? "enabled" : "disabled");
            if (previousEnabled) {
               $("#doquestion-question-preview-previous").on("click", () => {
                  getTaskQuestion({ ...options, qnum: data.qnum - 1 });
               });
            }
            $("#doquestion-question-preview-next").off("click");
            const nextEnabled = data.qnum < data.worksheet.numquestions;
            $("#doquestion-question-preview-next").attr("data-state", nextEnabled ? "enabled" : "disabled");
            if (nextEnabled) {
               $("#doquestion-question-preview-next").on("click", () => {
                  getTaskQuestion({ ...options, qnum: data.qnum + 1 });
               });
            }

            // Exit preview button.
            $("#doquestion-exit-task").html("Exit preview");
            $("#doquestion-exit-task").off("click").on("click", () => {
               window.location = revisionHubReturnLink || "/dashboard";
            });
            $("#doquestion-exit-task").show();
         }

         // Use a different submit handler if we are in worksheet preview mode.
         const submitHandler = data.worksheet
            ? (e) => {
               e.preventDefault();
               previewWorksheetSubmitHandler(data.worksheet.wid);
            }
            : doQuestionAnswerSubmitHandler;

         const renderedSuccessfully = dfm_generateQuestionContent($("#doquestion-question"), data.question, submitHandler, 1, theirAnswer);
         if (!renderedSuccessfully) {
            if (options.hasOwnProperty("qnum")) {
               markQuestionAsFailedToRender(options.aaid, options.qnum);
            } else {
               renderAdvanceQuestionModal();
            }
         }

         // Resize Desmos diagrams if necessary
         const screenWidth = $(window).width();
         $("#doquestion-question .desmos").each((_,el) => {
            if (el.offsetWidth > screenWidth - 140) {
               const newWidth = screenWidth - 140;
               const newHeight = (el.offsetHeight/el.offsetWidth)*newWidth;
               el.style.width = `${newWidth}px`;
               el.style.height = `${newHeight}px`;
            }
         });

         if(data.question.answer.type == "notanswerable")$("#doquestion-question input[type=submit]").hide();
         makeQuestionImagesClickable();

         // Question numbers for tasks based on an attempt or previewing a worksheet.
         $("#doquestion-qnums").empty();
         if(data.attempt || data.worksheet) {
            let numberOfQuestions = 0;
            if(data.attempt) {
               numberOfQuestions = data.numquestions || data.attempt.answers.length;
            } else {
               numberOfQuestions = data.worksheet.numquestions;
            }
            for(var i = 1; i <= numberOfQuestions; i++) {
               const currentQuestionNumber = i;
               $("#doquestion-qnums").append(`<li id='doquestion-q${currentQuestionNumber}'><span>Q${currentQuestionNumber}</span></li>`);

               $(`#doquestion-q${currentQuestionNumber}`).on("click", () => {
                  if (data.attempt) {
                     setQNum(currentQuestionNumber);
                  } else {
                     getTaskQuestion({ ...options, qnum: currentQuestionNumber });
                  }
               });

               if (i == data.qnum) {
                  $("#doquestion-q"+i).addClass('current');
               }

               if(data.attempt?.answers[i]) {
                  var ans = data.attempt.answers[i];
                  if(ans.failedRendering === true) $("#doquestion-q"+i).addClass('error');
                  else if(ans.iscorrect===true)$("#doquestion-q"+i).addClass('correct');
                  else if(ans.iscorrect===false)$("#doquestion-q"+i).addClass('incorrect');
                  else if(ans.iscorrect===undefined)$("#doquestion-q"+i).addClass('seen');
               }
            }
            $("#doquestion-qnums-container").css("display", "flex");
            $("#doquestion-qnums .current")[0].scrollIntoView({ behavior: isInitialLoad ? "instant" : "smooth", inline: "center" });
         }

         // Progress Meter
         if(data.attempt && data.percentprogress > 0) {
            const percentageToDisplay = Math.round(data.percentprogress);
            $("#doquestion-progress-label").html(percentageToDisplay + "%");
            $("#doquestion-progress-bar").css("width", percentageToDisplay + "%");
            $("#doquestion-progress-container").css("display", "flex");
         } else {
            $("#ddoquestion-progress-container").hide();
         }

         // Timer
         if(data.task && data.task.cdata && data.task.cdata.timelimit) {
            $("#doquestion-timeleft").css("display", "flex");
            startTimer(data.timeleft);
         } else {
            $("#doquestion-timeleft").hide();
         }

         // If already answered, re-display answer explanation box (although that box might not actually display the answer itself if they're not allowed to see it yet).
         // We also want to display the question side-box if the task is already complete.
         if(data.attempt?.answers[data.qnum]?.theiranswer || data.attempt?.complete) {
            displayExplanation(data.question, data.attempt.answers[data.qnum].iscorrect, data.attempt.complete, data.attempt.answers[data.qnum].theiranswer!=undefined, true);
            closeWhiteboard();
         }

         // If the task is complete, ensure the student can't answer any more questions.
         if(data.attempt && data.attempt.complete)$("#doquestion-question input[type=submit]").prop('disabled', true);

         // Render a question refresh button if query param is an ssid.
         if (preloadState.ssid) {
            $("#doquestion-question").prepend("<img id='doquestion-refresh' src='/images/refresh_icon.svg' alt='refresh question button' />");
            $("#doquestion-refresh").on("click", () => {
               $("#doquestion-question").empty();
               getTaskQuestion(preloadState);
            })
         }

         MathJax.typeset();

         // Render a scroll hint if the question is overflowing.
         handleScrollHint($("#doquestion-question"), $("#doquestion-question-scroll-hint"));

         // PostHog tracking.

         // Update the task and attempt objects for PostHog events.
         posthogTaskObject = data.task ?? {};
         posthogAttemptObject = data.attempt ?? {};

         // Destructure any PostHog trigger IDs provided.
         const { setWorkStartedTriggerId, taskContinuedTriggerId, pastPaperStartedTriggerId } = posthogTriggerIds;

         /**
          * PostHog event for starting a task *that has been set to the user*.
          *
          * Conditions for event:
          *
          * - Corresponding trigger ID has been provided.
          * - Task is being started.
          * - User is viewing their own attempt.
          * - User is not the task creator (to exclude independent practice).
          */
         const userIsViewingOwnAttempt = posthogAttemptObject.uid && Context.user?.uid === posthogAttemptObject.uid;
         const userIsTaskCreator = posthogTaskObject.creatorid && Context.user?.uid === posthogTaskObject.creatorid;
         const { userIsStartingTask } = data;
         if (setWorkStartedTriggerId && userIsStartingTask && userIsViewingOwnAttempt && !userIsTaskCreator) {
            posthogEventTaskSetWorkStarted({
               triggerId: setWorkStartedTriggerId,
               task: posthogTaskObject,
               attempt: posthogAttemptObject,
            });
         }

         /**
          * PostHog event for starting a past paper (independent practice) from the revision hub
          *
          * Conditions for event:
          *
          * - Corresponding trigger ID has been provided.
          * - Task is being started.
          * - User is viewing their own attempt.
          * - User is the task creator.
          * - Revision Hub is the referer
          */
         if (pastPaperStartedTriggerId && userIsStartingTask && userIsViewingOwnAttempt && userIsTaskCreator && fromRevisionHub) {
            posthogEventTaskIndependentPracticeStarted({
               triggerId: pastPaperStartedTriggerId,
               task: posthogTaskObject,
            });
         }

         /**
          * PostHog event for continuing a task.
          *
          * Conditions for event:
          *
          * - Corresponding trigger ID has been provided.
          * - Task is not being started.
          * - User is viewing their own attempt.
          */
         if (taskContinuedTriggerId && !userIsStartingTask && userIsViewingOwnAttempt) {
            posthogEventTaskContinued({
               triggerId: taskContinuedTriggerId,
               task: posthogTaskObject,
               attempt: posthogAttemptObject,
            });
         }
      },
      error: function(jqXHR) {
         // TAS-117: If we get an error (which presumably was a QG error), retry the attempt up to three times in total
         // This probably won't do anything for fixed [worksheet] tasks as the params are fixed, but there's little
         // harm in trying (and due to the error, we don't know what the task type is anyway)
         if (retryCount < 3) {
            getTaskQuestion(options, retryCount + 1, posthogTriggerIds);
         }
         else {
            const additionalInformation = getReadFriendlyStatusMessage(jqXHR.status) ?? jqXHR.responseText ?? null;
            if (options.aaid && !options.hasOwnProperty("qnum")) {
               renderAdvanceQuestionModal(additionalInformation);
            } else {
               const baseMessage = `An error occurred when trying to get the task data${additionalInformation ? `: <strong>${additionalInformation}</strong>` : "."}`;
               dfmAlert(baseMessage);
            }
         }
      }
   });
}

function markTaskAsComplete({ posthogTriggerId = null }) {
   let aaid = $(document).data("taskState").attempt.aaid;

   $.ajax({
      type: "POST",
      url: "/api/tasks/markascomplete/" + aaid,
      contentType:false,
      processData: false,
      cache: false,
      dataType: "json",
      success: function() {
         taskDone({ posthogTriggerId });
      },
      error: function(jqXHR){
         dfmAlert("There was an error marking the task as complete:<br><br><strong>"+jqXHR.responseText+"</strong>");
      }
   });
}

let continueLaterButtonClicked = false;
function continueLater() {
   let aaid = $(document).data("taskState").attempt.aaid;

   $.ajax({
      type: "POST",
      url: "/api/tasks/continuelater/" + aaid,
      contentType:false,
      processData: false,
      cache: false,
      dataType: "json",
      data: JSON.stringify({ fromRevisionHub }),
      success: function()
      {
         if (posthogAttemptObject.aaid) {
            posthogAttemptObject.paused = true;
         }
         continueLaterButtonClicked = true;
         window.location = revisionHubReturnLink || "/dashboard";
      },
      error: function(jqXHR){
         dfmAlert("There was an error trying to pause the task:<br><br><strong>"+jqXHR.responseText+"</strong>");
      }
   });
}

function convertSecondsToTime(t) {
   var negated = false;
   if(t<0) {
      t = -t; negated = true;
   }
   var minutes = Math.floor(t/60);
   var seconds = t%60;
   if(seconds<10)seconds = "0"+seconds;
   return (negated ? "-" : "")+minutes+":"+seconds;
}

var countdownTimer;
function startTimer(timeleft) {
   clearInterval(countdownTimer);
   countdownTimer = setInterval(function() {
      timeleft--;
      if(timeleft<0)return outOfTime();
      $("#doquestion-timeleft span").html(convertSecondsToTime(timeleft));
   }, 1000);
}

function outOfTime() {
   clearInterval(countdownTimer);
   $("#doquestion-timeleft span").html("0:00");
   markTaskAsComplete({ posthogTriggerId: "do-question-reach-task-time-limit" });
}


function makeQuestionImagesClickable() {
   // Allow any images in question to be importable into DFM Whiteboard.
   $(".question-content").find('img').addClass('wb-importable');
   $(".question-content").find('img, .desmos').wrap("<div class='qimg-wrapper' style='display:inline-block'></div>");
   $(".qimg-wrapper").append("<img src='/images/whiteboard_icon.svg' class='wb-indicator'>");
   $(".qimg-wrapper").find('img').first().click(function(){
   });
   $(".qimg-wrapper").click(function(){
      openWhiteboard();
      if($(this).find("img.wb-importable").length>0) {
         setWhiteboardImg($("#doquestion-whiteboard-main"), $(this).find("img.wb-importable").attr('src'), 1, false, false)
      } else {
         var calculator = $(this).find('.desmos').data('calculator');
         if (calculator) {
            calculator.asyncScreenshot({showLabels: true}, function(img) {
               setWhiteboardImgDesmos($("#doquestion-whiteboard-main"), img);
            });
         }
      }
   });

}

function setQNum(qnum) {
   var state = $(document).data("taskState");
   var isFixedTask = !!state.task.wid;
   var hasSeenQuestion = !!state.attempt.answers[qnum];
   if(qnum && !isFixedTask && !hasSeenQuestion) {
      dfmAlert("You are only permitted to skip questions if the questions on the task are already determined in advance (i.e. a worksheet or Past Paper).");
      return false;
   }

   if(isFeedbackRequiredAndNotGiven()) {
      dfmAlert("Your teacher has required that you give feedback on your answer.");
      return false;
   }


   var toSend = {aaid: state.attempt.aaid}
   if(qnum)toSend.qnum = qnum;
   getTaskQuestion(toSend);
}

function nextQuestion() {
   if(isFeedbackRequiredAndNotGiven()) {
      dfmAlert("Your teacher has required that you give feedback on your answer.");
      return false;
   }
   setQNum(); // if qnum not set, system will advance suitably.
}

function hasVideos(skills, subskill) {
   if(skills)for(var i=0; i<skills.length; i++)if(skills[i].subskills && skills[i].subskills[0].video)return true;
   if(subskill && subskill.video)return true;
   return false;
}

function doQuestionAnswerSubmitHandler() {
   var taskState = $(document).data("taskState");
   var qArea = $("#doquestion-question");

   closeKeyboard();
   var question = taskState.question;
   var qnum = taskState.qnum;

   var aaid = taskState.attempt ? taskState.attempt.aaid : undefined;
   var requireWorking = taskState.task&&taskState.task.cdata ? taskState.task.cdata.requireworking : false;
   var input = getAnswerInput(qArea, question);

   var whiteboard = $("#doquestion-whiteboard-main").data("core");
   var whiteboardSend;
   if(whiteboard && (requireWorking===true || requireWorking===1 || requireWorking===2)) {
      whiteboardSend = { strokes: compressStrokes(whiteboard.strokes), 
            width: whiteboard.width, height: whiteboard.height, grid: whiteboard.grid, img: whiteboard.img, imgScale: whiteboard.imgScale };
      if(whiteboard.strokes.length==0 && (requireWorking===true || requireWorking===1)) {
         dfmAlert("Your teacher has required that you include working with your answer. Please use the mini-whiteboard provided.");
         qArea.find('input[type=submit]').prop('disabled', false);
         qArea.find('input[type=submit]').val('Submit Answer');
         return false;
      }
   }

   if (!input && question.answer.type != "none") {
      dfmAlert("Please ensure your answer is fully entered.");
      qArea.find('input[type=submit]').prop('disabled', false);
      qArea.find('input[type=submit]').val('Submit Answer');
      return false;
   }
   console.log(JSON.stringify(input));

   var data = {userAnswer: input};
   if (question.qid) data.qid = question.qid;
   if (qnum) data.qnum = qnum;
   if (aaid) data.aaid = aaid;
   if (whiteboardSend) data.whiteboard = whiteboardSend;
   if (question.subskill && question.subskill.ssid) data.ssid = question.subskill.ssid;
   if (question.params) data.params = question.params;

   console.log("DataToSend: " + JSON.stringify(data));

   var url = "/api/tasks/submitanswer";
   console.log("Submitting answer to: " + url);
   console.log("Question: " + JSON.stringify(question));
   $.ajax({
      type: "POST",
      url: url,
      contentType: false,
      processData: false,
      cache: false,
      data: JSON.stringify(data),
      dataType: "json",
      success: function (data) {
         /**
          * For PostHog events, we want to keep the task attempt object
          * up to date with questions answered.
          */
         if (!data.warn && typeof data.iscorrect === "boolean") {
            if (posthogAttemptObject.numcompleted && posthogAttemptObject.numcorrect) {
               posthogAttemptObject.numcompleted[0]++;
               if (data.iscorrect) {
                  posthogAttemptObject.numcorrect[0]++;
               }
            }
         }

         console.log("Data from answer marker: " + JSON.stringify(data));
         responseFunction(data);
      },
      error: function (jqXHR, textStatus, errorThrown) {
         qArea.find('input[type=submit]').prop('disabled', false);
         qArea.find('input[type=submit]').val('Submit Answer');
         dfmAlert("There was an error submitting your answer:<br><br><strong>" + jqXHR.responseText + "</strong>");
      }
   });

   return false;
}

/**
 * Used to display a modal when a user tries to submit an answer to a question
 * when in worksheet preview mode. The modal will prompt the user to log in or
 * register to view the full paper. If the user is already logged in, they will
 * be offered a link to go to the full paper.
 */
function previewWorksheetSubmitHandler(wid) {
   const onModalClose = () => {
      $("#doquestion-question input[type=submit]").prop("disabled", false);
   }

   const loggedInContent = `
      <div style="align-items: center; display: flex; flex-direction: column; gap: 32px; padding-bottom: 24px; padding-top: 32px;">
         <div>
            <h2 style="color: #0F191F; font-size: 24px; margin: 0; margin-bottom: 16px; text-align: center;">
               You are already logged in
            </h2>

            <p style="color: #5F7178; line-height: 24px; margin: 0; text-align: center;">
               You are currently viewing the preview of this paper. Click the button below to go to the full version where you can check your answer and track your progress.
            </p>
         </div>

         <button
            id="modal-start-button"
            style="background: #0F191F; border-radius: 8px; color: white; width: 200px;"
         >
            Continue to full paper
         </button>
      </div>
   `;

   const loggedOutContent = `
      <div style="align-items: center; display: flex; flex-direction: column; gap: 32px; padding-bottom: 24px; padding-top: 32px;">
         <div>
            <h2 style="color: #0F191F; font-size: 24px; margin: 0; margin-bottom: 16px; text-align: center;">
               Check your answer & save your progress
            </h2>

            <p style="color: #5F7178; line-height: 24px; margin: 0; text-align: center;">
               Log in or register to see how you did, keep track of your progress and supercharge your exam revision. Student accounts are free!
            </p>
         </div>

         <div style="display: flex; gap: 16px;">
            <button
               id="modal-register-button"
               style="background: transparent; border: 1px solid #0F191F; border-radius: 8px; color: #0F191F; width: 120px;"
            >
               Register
            </button>

            <button
               id="modal-login-button"
               style="background: #0F191F; border-radius: 8px; color: white; width: 120px;"
            >
               Log in
            </button>
         </div>
      </div>
   `;

   dfmAlert(Context.user ? loggedInContent : loggedOutContent, onModalClose);

   $("#modal-start-button").on("click", () => {
      window.location = `/revision/papers/start/${wid}`;
   });

   $("#modal-register-button").on("click", () => {
      window.location = "/registration";
   });

   $("#modal-login-button").on("click", () => {
      /**
       * Redirect the user to the revision hub start route after logging in,
       * which will create a new attempt for the worksheet and send them back
       * to do-question with the new attempt ID. We need to include the "from"
       * query param to ensure the user's revision hub selection is preserved.
       */
      window.location = `/login?redirectTo=/revision/papers/start/${wid}?from=preview`;
   });
}

// If show = false, sets up explanation box (without 'next' buttons) but doesn't display. If true, immediately displays.
function displayExplanation(question, iscorrect, istaskcomplete, wasanswered, show) {
   $("#doquestion-response h1").empty();
   $("#doquestion-response-content").empty();
   $("#doquestion-response h1").removeClass('incorrect').removeClass('correct').removeClass('recorded');

   var task = $(document).data("taskState").task;
   // Answer hidden if (a) a fixed-question task and (b) student can reattempt task after end.
   var hideIncorrect = iscorrect===false && task && task.cdata && task.cdata.preventreattempts===false && task.wid;
   // console.log("TASKCDATA: "+JSON.stringify(task.cdata));

   if(istaskcomplete && !wasanswered) {
      $("#doquestion-response h1").addClass('recorded');
      $("#doquestion-response h1").html("Not answered");
      $("#doquestion-response-content").html("<p style='font-weight:700'>You didn't complete this question.</p>");
   } else if(iscorrect==undefined) {
      $("#doquestion-response h1").addClass('recorded');
      $("#doquestion-response h1").html("<img src='images/tick_icon.svg'> Recorded");
      $("#doquestion-response-content").html("<p style='font-weight:700'>Your answer has been recorded.</p>");
   } else if(iscorrect) {
      $("#doquestion-response h1").addClass('correct');
      $("#doquestion-response h1").html("<img src='images/tick_icon.svg'> Correct");
      $("#doquestion-response-content").html("<p style='font-weight:700'>The answer is <span id='doquestion-correctanswer'></span></p>"
         + "<p>"+replaceMathsTags(question.response)+"</p>");
   } else {
      $("#doquestion-response h1").addClass('incorrect');
      $("#doquestion-response h1").html("<img src='images/cross_icon.svg'> Incorrect");
      if(!hideIncorrect) {
         $("#doquestion-response-content").html("<p style='font-weight:700'>The answer is <span id='doquestion-correctanswer'></span></p>"
            + "<p>"+replaceMathsTags(question.response)+"</p>");
      }
      else {
         $("#doquestion-response-content").html("<p>As your teacher has allowed reattempts on this task, we have hidden the correct answer.</p>");
         $(".answer-content .correctanswer").remove();
      }

   }
   if (question.answer && question.answer.correctAnswer && !hideIncorrect) {
      insertHTMLAnswer($("#doquestion-correctanswer"), question, question.answer.correctAnswer, false);
   }

   if (istaskcomplete) {
      displayTaskCompleteMessage();
      $("#doquestion-response-buttons").hide();
   } else {
      $("#doquestion-response-buttons").show();
   }

   $("#doquestion-response").toggleClass("exam-question", !!question.qid);

   if(show)$("#doquestion-response").show();

   // Render a scroll hint if the response is overflowing. Use a timeout to allow images to load.
   setTimeout(() => {
      handleScrollHint($("#doquestion-response-content"), $("#doquestion-response-scroll-hint"));
   }, 500);
}

function displayTaskCompleteMessage() {
   $("#doquestion-response-content").after(`
      <div class="doquestion-task-complete-container">
         <div class="doquestion-task-complete-content">
            <h3>You have completed this ${fromRevisionHub ? "paper" : "task"}.</h3>
            <p>Use the question numbers at the top of the page to switch between your answers or click the button to exit.</p>
         </div>
         <button id="doquestion-task-complete-exit-button" class="doquestion-response-button">
            Exit ${fromRevisionHub ? "paper" : "task"}
         </button>
      </div>
   `);

   const leaveTask = () => window.location = revisionHubReturnLink || "/dashboard";
   $("#doquestion-task-complete-exit-button").on("click", leaveTask);

   // Update the exit task link at the top of the page for consistency.
   $("#doquestion-exit-task").off("click").on("click", leaveTask);
}

function responseFunction(data) {

   console.log("[ResponseData] "+JSON.stringify(data));

   justAnswered = true;
   lastAnswerWasCorrect = data.iscorrect;

   if(data.warn) {
      $("#doquestion-question input[type=submit]").attr("value","Submit Answer");
      $("#doquestion-question input[type=submit]").prop('disabled',false);
      dfmAlert("<p style='text-align:center;font-size:30px;line-height:35px'><img src='/images/wink_icon.svg' style='margin:40px;width:60px'><br>Ooops. That's not right. Try it again.</p>");

      // TAS-525: We need to set focus on this popup.  dfmAlert() annoyingly doesn't return any reference to the popup it's created, so we'll just
      //   open up that black box and assume the naming scheme isn't going to change.  (And it is unlikely to change, for the same reason I feel
      //   it's infeasible to change its return type!)
      // Note as well that the modal is only actually displayed after a 200ms timeout, so we need to wait longer before focusing on it
      const winkDivId = "#message-" + Context.messageCounter;
      setTimeout(function () {
         $(winkDivId + " .close-modal").focus();
      }, 250);

      return;
   }

   displayExplanation(data.question, data.iscorrect, data.iscomplete, true, false);

   if (preloadState.aaid) {
      if (data.iscomplete) {
         $("#doquestion-progress-label").html("100%");
         $("#doquestion-progress-bar").css("width", "100%");
         $("#doquestion-response-buttons").empty();
         taskDone({ posthogTriggerId: "do-question-complete-task" });
      } else {
         if (data.cancomplete) {
            $("#doquestion-response-buttons")
               .html(`
                  <button class='doquestion-response-button secondary' id='forcecomplete-button'>
                     Finish this task
                  </button>
                  <button class='doquestion-response-button' id='nextquestion-button'>
                     Next question
                  </button>
               `);
         } else {
            $("#doquestion-response-buttons")
               .html(`
                  <button class='doquestion-response-button secondary' id='continuelater-button'>
                     Continue later
                  </button>
                  <button class='doquestion-response-button' id='nextquestion-button'>
                     Next question
                  </button>
               `);
         }
      }
   }

   if (preloadState.ssid) {
      $("#doquestion-response-buttons").empty();
      $("#doquestion-response-buttons").append("<button id='view-on-explorer-button'>Browse this Skill</button>");
      $("#view-on-explorer-button").on("click", () => window.location = `/explorer.php?ssid=${preloadState.ssid}`);
   }

   if (preloadState.qid) {
      $("#doquestion-response-buttons").empty();
      $("#doquestion-response-buttons").append("<button id='browse-questions-button'>Browse Questions</button>");
      $("#browse-questions-button").on("click", () => window.location = `/browse.php?qid=${preloadState.qid}`);
   }
  
  setTimeout(function(){
      $("#doquestion-response").fadeIn();
      $([document.documentElement, document.body]).animate({
         scrollTop: $("#doquestion-response").offset().top
      }, 1000);

      // Resize Desmos diagrams if necessary
      const screenWidth = $(window).width();
      $("#doquestion-response .desmos").each((_,el) => {
         if (el.offsetWidth > screenWidth - 170) {
            const newWidth = screenWidth - 170;
            const newHeight = (el.offsetHeight/el.offsetWidth)*newWidth;
            el.style.width = `${newWidth}px`;
            el.style.height = `${newHeight}px`;
         }
      });

      closeWhiteboard();

      $("#nextquestion-button").click(nextQuestion);
      $("#continuelater-button").click(continueLater);
      $("#forcecomplete-button").click(function(){
         $("#doquestion-response-buttons").empty();
         displayTaskCompleteMessage();
         markTaskAsComplete({ posthogTriggerId: "do-question-finish-task-button" });
      });

      MathJax.typeset();

      // Mastery
      if(data.iscorrect) {
         if(data.performanceupdate?.skillupdates && Object.keys(data.performanceupdate.skillupdates).length>0) {
            $("#doquestion-mastery").css("display","flex");

            var firstSkillId = Object.keys(data.performanceupdate.skillupdates)[0];
            var update = data.performanceupdate.skillupdates[firstSkillId]; // if multiple skills, only report first (somewhat arbitrarily).

            $("#doquestion-mastery-label").html(`Your mastery for skill ${update.publicid} has ${update.new > update.old ? "increased" : "stayed the same"}.`);
            $("#doquestion-mastery-bar").dfmMasterySlidingBar();
            $("#doquestion-mastery-bar").dfmMasterySlidingBar("setValue", update.old);
            setTimeout(function() {
               $("#doquestion-mastery-bar").dfmMasterySlidingBar("setValue", update.new);
            }, 500);
         } else {
            if(data.performanceupdate?.pointsearned) {
               $("#doquestion-mastery").css("display","flex");
               $("#doquestion-mastery-label").html("You earned " + data.performanceupdate.pointsearned + " practice points.");
            }
         }
      }

      // Confetti!
      if(data.iscorrect)confetti({
               angle: 270,
               spread: 270,
               particleCount: 75,
               startVelocity: 25,
               origin: { x: 0.2, y: 0 }
            });

      // Trophies earned.
      if(data.trophiesearned && data.trophiesearned.length!=0) {
         var trophyHTML = "";
         trophyHTML+="<h2>You've earned a <strong>trophy</strong>!</h2>";
         trophyHTML+="<p><div class='update-row' style='max-height:300px;overflow-y:auto'>";
         $.each(data.trophiesearned, function(kt,trophy) {
            trophyHTML+="<div class='trophy-bar'><img src='/images/trophy_icon.svg'><h3><strong class='"+trophy.medal+"'>"+trophy.medal+":</strong> "+trophy.name+"</h3><p>"+trophy.description+"<p></div>";
         });
         trophyHTML+="</div></p>";
         dfmAlert(trophyHTML);
         var end = Date.now() + (5 * 1000);        
         (function frame() {
               confetti({
                 particleCount: 2,
                 angle: 60,
                 spread: 55,
                 origin: { x: 0 }
               });
               confetti({
                 particleCount: 2,
                 angle: 120,
                 spread: 55,
                 origin: { x: 1 }
               });
               if (Date.now() < end) {
                  requestAnimationFrame(frame);
               }
         }());
      }

      // Feedback
     if (isStudent()) {
        const feedbackMsg = isFeedbackRequired() ? "You are required to leave a comment for your teacher about this question/your answer." : "You can optionally leave a comment for your teacher about this question/your answer.";
        const feedbackLimit = 500;

        $("#doquestion-question").append(`
            <div id='feedback-area'>
               <textarea id='feedback' placeholder='${feedbackMsg} Press Alt+Equals to insert mathematical expressions.'></textarea>
               <p class='feedback-limit-warning' style='color: red; display: none; font-size: 12px; margin-bottom: 0; margin-top: 4px;'>
                  Feedback is limited to a maximum length of ${feedbackLimit} characters.
               </p>
               <br>
               <button>Send</button>
            </div>`);

        $("#feedback-area textarea").dfmInputWithInsertableMaths();

        // Handle feedback character limit.
        $("#feedback-area textarea").on("input", function(e) {
            const feedbackLimitExceeded =  e.target.value.length > feedbackLimit

            // Add a border and outline to the text area if the limit is exceeded.
            $(this).css("border-color", feedbackLimitExceeded ? "red" : "").css("outline-color", feedbackLimitExceeded ? "red" : "");

            // Show the feedback limit warning if the limit is exceeded.
            $("#feedback-area .feedback-limit-warning").toggle(feedbackLimitExceeded);

            // Disable the send button if the limit is exceeded.
            $("#feedback-area button").attr('disabled', feedbackLimitExceeded).css('opacity', feedbackLimitExceeded ? 0.5 : 1);
        });

        $("#feedback-area button").click(function () {
          const message = $("#feedback-area textarea").val().trim();
          if (message === "") {
            dfmAlert("No feedback written.");
          } else {
            $("#feedback-area textarea").attr('disabled', true).css('opacity', 0.5);
            $("#feedback-area button").attr('disabled', true).css('opacity', 0.5);
            sendFeedback(message);
          }
        });
     }

      MathJax.typeset();
  }, 50);
}

function isFeedbackRequired() {
   if(!justAnswered)return false;
   var requireFeedback = $(document).data("taskState").task && $(document).data("taskState").task.cdata
            ? $(document).data("taskState").task.cdata.requirefeedback
            : 0;
   return requireFeedback==2 || (lastAnswerWasCorrect===false && requireFeedback==1); // 1 means "required if wrong" and 2 means "required".
}

function isFeedbackRequiredAndNotGiven() {
   if(!isFeedbackRequired())return false;
   return !$("#feedback-area h2").is(':visible'); // this is the 'feedback sent' message.
}


let notifiedOfCompletion = false;
let lastAnswerWasCorrect;

function taskDone(options = {}) {
   const { posthogTriggerId } = options;

   if (notifiedOfCompletion) {
      return;
   }

   let aaid = $(document).data("taskState").attempt.aaid;
   let aid = $(document).data("taskState").task.aid;

   $.ajax({
      url: "/api/tasks/completionstats/" + aaid,
      contentType: false,
      processData: false,
      cache: false,
      dataType: "json",
      success: function (data) {
         notifiedOfCompletion = true;

         // If data is false, this indicates results are still secret from this user.
         let buttons = [];
         buttons.push({
            label: "Exit", action: function () {
               window.location = revisionHubReturnLink || "/dashboard";
            }
         });
         buttons.push({
            label: !data ? "Review Your Answers" : "Review Answers", action: function () {
               window.location = 'progress.php?aid=' + aid;
            }
         });

         setTimeout(function () {
            if (!data) {
               dfmDialog("<div class='taskcomplete'><h1>This task is now complete.</h1>"
                   + "<p>As the task was an assessment, the results are not yet available.</p>", buttons);
            } else {
               dfmDialog("<div class='taskcomplete'><h1>You achieved <span>" + data.mark + "/" + data.outof + "</span></h1>"
                   + "<h2>Points</h2>"
                   + "<p>You earned " + Math.round(data.points) + " practice points.</p>"
                   + "<h2>Mastery</h2>"
                   + "<ul id='taskcomplete-performanceupdate'></ul>"
                   + "<div id='taskcomplete-recommendations-container'>"
                   + "<h2>Recommendations</h2>"
                   + "<ul id='taskcomplete-recommendations'></ul>"
                   + "</div>"
                   + "<ul id='taskcomplete-recommendations'></ul>", buttons);
               $.each(data.recommendations, function (k, r) {
                  $("#taskcomplete-recommendations").append("<li><a href='explorer.php?skid=" + r.skill.skid + "'><em>" + r.skill.publicid + "</em> " + r.skill.name + "</a></li>");
               });
               if (data.mastery) {
                  $.each(data.mastery, function (skid, { value, publicid, name }) {
                     $("#taskcomplete-performanceupdate").append("<li id='taskcomplete-performanceupdate-" + skid + "'>"
                         + "<span id='taskcomplete-performanceupdate-" + skid + "-to' class='taskcomplete-mastery'>" + value + "</span>"
                         + "<label><em>" + publicid + "</em> " + name + "</label>"
                         + "</li>");
                     $("#taskcomplete-performanceupdate-" + skid + "-to").dfmMasteryBar(value);
      
                  });
               }
            }
            $(".modal").addClass('blue-dialog');
            $(".modal button").addClass('empty-onblue');
            $(".modal .dialog-buttons").addClass('taskcomplete-buttons');
         }, 500);
      },
      error: function (jqXHR, textStatus, errorThrown) {
         dfmAlert("There was an error obtaining the task completion data:<br><br><strong>" + jqXHR.responseText + "</strong>");
      }
   });

   // PostHog event for task completion.
   const userIsViewingOwnAttempt = posthogAttemptObject.uid && Context.user?.uid === posthogAttemptObject.uid;
   if (userIsViewingOwnAttempt && posthogTriggerId) {
      posthogAttemptObject.complete = true;
      posthogEventTaskCompleted({
         triggerId: posthogTriggerId,
         task: posthogTaskObject,
         attempt: posthogAttemptObject,
      });
   }
}

function sendFeedback(message) {
   let taskState = $(document).data("taskState");

   let data = {
      aaid: taskState.attempt.aaid,
      qnum: taskState.qnum,
      message: message
   }

   $.ajax({
      url: "/api/tasks/feedback",
      type: "POST",
      contentType: false,
      processData: false,
      cache: false,
      data: JSON.stringify(data),
      dataType: "json",
      success: function (data, textStatus, jqXHR) {
         $("#feedback-area").html("<h2 style='margin:0px'>Feedback sent.</h2>");
      },
      error: function (j, textStatus, errorThrown) {
        $("#feedback-area textarea").attr('disabled', false).css('opacity', 1);
        $("#feedback-area button").attr('disabled', false).css('opacity', 1);
        dfmAlert("There was an error sending this feedback:<br><br><strong>" + j.responseText + "</strong>");
      }
   });
}

/**
 * Checks if a specified container is overflowing and handles the display
 * of the scroll hint passed in accordingly.
 */
function handleScrollHint($container, $scrollHint) {
   // Helper to check if the content of the container.
   const isQuestionContentOverflowing = () => {
      const scrollWidth = $container[0].scrollWidth;
      const containerWidth = $container.width();
      return scrollWidth > containerWidth;
   }

   // Helpers to show and hide the scroll hint.
   const showScrollHint = () => $scrollHint.show();
   const hideScrollHint = () => $scrollHint.hide();

   // Start with the scroll hint hidden.
   hideScrollHint();

   /**
    * If we do have an overflow:
    *
    * - Set the text of the hint according to whether the device is touch-enabled.
    * - Display the scroll hint.
    * - Set an event listener to remove the hint when the user scrolls the container.
    * - Set an event listener to remove the hint if the screen is resized and the overflow is gone.
    */
   const loadedWithOverflow = isQuestionContentOverflowing();
   if (loadedWithOverflow) {
      const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
      const scrollHintText = isTouchDevice ? "Swipe to see more" : "Scroll to see more";
      $scrollHint.children(".scroll-hint-message").text(scrollHintText);

      showScrollHint();

      $container.on("scroll", hideScrollHint);

      $(window).on("resize", () => {
         const noMoreOverflow = !isQuestionContentOverflowing();
         if (noMoreOverflow) {
            hideScrollHint();
         }
      });
   }
}