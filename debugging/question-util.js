// Use Sentry to send question generator errors.
import * as Sentry from "@sentry/browser";

// Loaded from CDN and included in externals in webpack.config.js
import MathJax from "mathjax";

// Required JS from local files
import { Context, andJoinArray, dfmAlert } from "./dfm5";
import { closeKeyboard } from "./algebra-1.8";
import { compressStrokes } from "./dfm-whiteboard-new";
import { buildErrorMessageHtml } from "~/utils/errors";

/* ----------------------------------------------------------------------------
Params: qArea = selector for the question area (where the form can be found)
        responseFunction = how to respond to the data that comes back
   ---------------------------------------------------------------------------- */
export function answerSubmitHandler(qArea, responseFunction, requireWorking) {
   closeKeyboard();

   let question = qArea.data("question");
   let permid = qArea.data("permid") ? qArea.data("permid") : question.permid; // should just be latter really!
   let params = qArea.data("params") ? qArea.data("params") : question.params; // again, should just be question.params! Why separate?!
   let qnum = qArea.data("qnum");
   let aaid = qArea.data("aaid");
   let input = getAnswerInput(qArea, question);
   let whiteboard = $("#whiteboard").data("core");
   let whiteboardSend;

   if (requireWorking === true || requireWorking === 1 || requireWorking === 2) {
      whiteboardSend = {
         strokes: compressStrokes(whiteboard.strokes),
         width: whiteboard.width,
         height: whiteboard.height,
         grid: whiteboard.grid,
         img: whiteboard.img,
         imgScale: whiteboard.imgScale
      };
      if (whiteboard.strokes.length == 0 && (requireWorking === true || requireWorking === 1)) {
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

   let data = {userAnswer: input};

   if (question.qid && !permid) {
      data.qid = Number.parseInt(question.qid);
   }
   if (qnum) {
      data.qnum = qnum;
   }
   if (aaid) {
      data.aaid = aaid;
   }
   if (whiteboardSend) {
      data.whiteboard = whiteboardSend;
   }
   if (permid) {
      data.permid = permid;
   }
   if (params) {
      data.params = params;
   }

   // process-answer-new.php accepted data.question but TaskController::submitAnswer() does not care
   // about such a field. Instead, to get manage-keyskills.php working, I'm extracting and setting ssid on the
   // request payload.
   if ((params && !permid) || (!params && !question.id)) {
      data.question = question;
      data.ssid = question.subskill && question.subskill.ssid ? question.subskill.ssid : undefined;
   }

   let payload = JSON.stringify(data);
   console.log("[answerSubmitHandler] Sending: " + payload);

   $.ajax({
      type: "POST",
      url: "/api/tasks/submitanswer",
      contentType: false,
      processData: false,
      cache: false,
      data: payload,
      dataType: "json",
      success: function (data) {
         console.log("Data from answer marker: " + JSON.stringify(data));
         responseFunction(data, aaid);
      },
      error: function (jqXHR, textStatus, errorThrown) {
         qArea.find('input[type=submit]').prop('disabled', false);
         qArea.find('input[type=submit]').val('Submit Answer');
         dfmAlert("There was an error submitting your answer:<br><br><strong>" + jqXHR.responseText + "</strong>");
      }
   });

   return false;
}

export function defaultResponseFunction(qArea) {
   console.log("[SubmitAnswer2] form = "+qArea.find('form').attr('id'));
   return function(data) {
      let question = qArea.data("question");
      let html = "";

      if(question.answer.type=="desmos_line") {
         question.answer.type = "desmos";
      } // legacy

      qArea.find('input[type=submit]').slideUp();
      qArea.append("<div id='response-area'></div>");

      if (data.iscorrect) {
         html += "<h1 class='correct'>&#10004; Correct</h1>";
      } else {
         html += "<h1 class='incorrect'>&#10006; Incorrect</h1>";
      }

      html+= "<p style='font-weight:700'>The answer is "+showHTMLAnswer(question, data.question.answer.correctAnswer)+"</p>";
      html+= "<p>"+replaceMathsTags(data.question.response)+"</p>";

      qArea.find("#response-area").html(html);
      qArea.find("#response-area").find('.solution-canvas').dfmCanvas({
         editMode: false,
         readOnly: true,
         answerData: question.answer.data,
         answer: data.question.answer
      });

      if (question.answer.type==="desmos") {
         qArea.find('.desmos-calculator-solution').dfmDesmosLine({
            answerData: question.answer.data,
            answer: question.answer.correctAnswer
         })
      };
      qArea.find("#response-area").find('.canvas-message').hide();

      MathJax.typeset();
   }
}



export function getAnswerInput(qArea, question) {
   if(question.answer.type=="desmos_line")question.answer.type = "desmos"; // legacy

   var form = qArea.find('form');
   var answerType = question.answer.type;
   if(answerType==="textual" || answerType==="numeric") {
      var tAnswers = [];
      var missing = false;
      form.find("input[type=text]").each(function(){ 
         if($(this).val()==""){ missing = true; return false; }
         else tAnswers.push($(this).val());
      });
      return missing ? false : tAnswers;
   }
   else if(answerType==="expression") {
      var latex = form.find('#expression-answer').algebraicInput("latex");
      return latex ? latex : false;
   }
   else if(answerType==="inequality") {
      var ranges = [];
      form.find('.inequality-rows').children().each(function(i) {
         var op = $(this).data("op");
         var variable = $(this).data("var");
         var args = [];
         if(op=="<<" || op=="<<=" || op=="<=<" || op=="<=<=")args.push( $(this).find('.ineqarg-left').algebraicInput("latex") );
         args.push( $(this).find('.ineqarg-right').algebraicInput("latex") );
         ranges.push( { op: op, args: args, var: variable } );
      });
      return ranges.length==0 ? false : ranges;
   }
   else if(answerType==="desmos") {
      var calculator = form.find(".desmos-calculator").data("calculator");
      var exprs = calculator.getExpressions();
      var points = [];
      if(question.answer.data.mode==="multiline")question.answer.data.mode="geometric"; // legacy renaming

      if(question.answer.data.mode==="geometric") {
         for(var i=1; i<=question.answer.data.numpoints; i++) {
            points.push({ x: extractDesmosValue(exprs, "aX"+i), y: extractDesmosValue(exprs, "aY"+i) });     
         }
      } else if(question.answer.data.mode==="circle") {
         return {centre: {x: extractDesmosValue(exprs, "v1"), y: extractDesmosValue(exprs, "v2")}  , point: {x: extractDesmosValue(exprs, "v3"), y: extractDesmosValue(exprs, "v4")} }

      } else if(question.answer.data.mode==="boxplot") {
         for(var i=0; i<5; i++)points.push(extractDesmosValue(exprs, "aX"+i));
      } else if(question.answer.data.mode==="barchart") {
         // First work out how many input points.
         var numbars = 0;
         for(var i=0; i<question.answer.data.bars.length; i++)if(!question.answer.data.bars[i].frequency)numbars++;
         for(var i=0; i<numbars; i++)points.push(extractDesmosValue(exprs, "aY"+i));
      } else if ([1,2,3].includes(question.answer.data.order)) {
         for(let i = 1; i <= question.answer.data.order + 1; i++) {
            // The IDs set as second argument here have to match those defined when setting up the Desmos expreessions in dfm_generateQuestionContentDo.
            points.push({ x: extractDesmosValue(exprs, "aX" + i), y: extractDesmosValue(exprs, "aY" + i) });
         }
      }
      return points;
   }
   else if(answerType==="eqnsolutions") {
      var solutionRows = form.find(".solution-row");
      var solutionA = [];
      var invalid = false;
      solutionRows.each(function(){
         var solutionAR = [];
         $(this).children("span").each(function(){
            var operator = "=";
            if($(this).find('select').length==1)operator = $(this).find('select').val();
            var latex = $.trim($(this).find('.eqnsolutions-answerinput').algebraicInput("latex"));
            if(latex===""){
               invalid = true;
               return false; // break from loop
            }
            solutionAR.push({operator:operator, answer:latex});
         });
         if(invalid)return false;
        solutionA.push(solutionAR);
      });    
      return invalid ? false : solutionA;
   }
   else if(answerType==="shape") {
      var canvas = form.find('.question-canvas');
      var theirAnswerShape = canvas.dfmCanvas("getAnswerData").correctAnswer; // their shape not actual correct answer.
      console.log("[util-questionutils-new] theirAnswerShape = "+JSON.stringify(theirAnswerShape));

      if (!theirAnswerShape || theirAnswerShape.points.length === 0) return false;
      else {
         theirAnswerShape.width = canvas.width();
         theirAnswerShape.height = canvas.height();
         if (canvas.data('grid') && canvas.data('grid').v === 2) theirAnswerShape.v = 2; // version 2
         return theirAnswerShape;
      }
   }
   else if(answerType==="multiplechoice") {
       if(!question.answer.data.multiple) {
          var a = form.find("input[name='multiplechoice-answer[]']:checked").val();
          return a ? a : false;
       } else {
          var vals = [];
          form.find("input[name='multiplechoice-answer[]']:checked").each(function(){ 
             vals.push( parseInt($(this).val()) ); 
          });
          vals.sort();
          return vals.length==0 ? false : vals;
       }
   }
   else if(answerType==="ratio") {
      var solutionA = [];
      var invalid = false;
      form.find(".expression-answer-ratio").each(function(){
         var latex = $(this).algebraicInput("latex");
         if(latex===""){
            invalid = true;
            return false; // break from loop
         }
         solutionA.push(latex);
      });
      return invalid ? false : solutionA;
   }
   else if(answerType==="fraction") {
      var numer = form.find("input[name=fraction-numer]").val();
      var denom = form.find("input[name=fraction-denom]").val();
      var whole = form.find("input[name=fraction-whole]").val();
      if(numer)numer = parseInt(numer);
      if(denom)denom = parseInt(denom);
      if(whole)whole = parseInt(whole);
      if(question.answer.data.type==="mixed" && !whole)return false;
      if(!numer || !denom)return false;
      return whole ? {"numer": numer, "denom": denom, "whole": whole} : {"numer": numer, "denom": denom};
   }
   else if(answerType==="coordinate") {
      var expr1x = form.find(".expression-answer-x").algebraicInput("latex");
      var expr1y = form.find(".expression-answer-y").algebraicInput("latex");
      var expr1z = question.answer.data.dimensions==3 ? form.find(".expression-answer-z").algebraicInput("latex") : undefined;
      if(!expr1x || !expr1y)return false;
      if(question.answer.data.dimensions==3 && !expr1z)return false;
      return question.answer.data.dimensions==3 ? {x: expr1x, y: expr1y, z: expr1z } : {x: expr1x, y: expr1y };
   }
   else if(answerType==="table") {
      form.find("input[name=expression-answer-table]").remove();
      form.append("<input type='hidden' name='expression-answer-table'>");
      var theirAnswers = [];
      var cols = question.answer.data.cols;
      var rows = question.answer.data.rows;
      for(var r=1; r<=rows; r++) {
         var currentRow = [];
         for(var c=1; c<=cols; c++) {
            if(question.answer.data.fixedVals[r-1][c-1]==="") {
               var theirAnswer = form.find("input[name=table-answer-"+r+"-"+c+"]").val();
               if($.trim(theirAnswer)==="") {
                  return false;
               }
               if(question.answer.data.type==="list")theirAnswer = turnListStringIntoArray(theirAnswer);
               currentRow.push(theirAnswer);
            }
            else currentRow.push("");
         }
         theirAnswers.push(currentRow);
      }
      return theirAnswers;
   }
   else if(answerType==="ordered") {
      var theirAnswers = [];
      form.find(".answer-content").children().each(function(i){
         theirAnswers[$(this).data("order") - 1] = i + 1;
      });
      return theirAnswers;      
   }
   else if(answerType==="standardform") {
      var exprMain = form.find(".expression-answer-main").algebraicInput("latex");
      var exprPower = form.find(".expression-answer-power").algebraicInput("latex");
      if(!exprMain || !exprPower)return false;
      return {main: exprMain, power: exprPower}
   }
   else if(answerType==="vector") {
      var latexAnswers = [];
      var invalid = false;
      var currentRow = [];
      var i = 0;
      form.find(".expression-answer-cell").each(function(){
         var expr = $(this).algebraicInput("latex");
         if(!expr){ invalid = true; return false; }
         currentRow.push(expr);
         i++;
         if(i%question.answer.data.cols==0) {
            latexAnswers.push(currentRow);
            currentRow = [];
         }
      });
      if(invalid)return false;
      else return latexAnswers;

   }
   else if(answerType==="list") {
      var theirAnswer = $.trim(form.find("input[name=list-answer]").val());
      if(!theirAnswer)return false;
      return turnListStringIntoArray(theirAnswer);
   }


}

function extractDesmosValue(list, id) {
   for(var i=0; i<list.length; i++) {
      if(list[i].id==id)return list[i].latex.substr(list[i].latex.indexOf("=")+1);
   }
}

function turnListStringIntoArray(theirAnswer) {
   theirAnswer = theirAnswer.toLowerCase();
   while(theirAnswer.indexOf("  ")>=0)theirAnswer = theirAnswer.replace("  "," ");
   var andPos = theirAnswer.indexOf(" and ");
   var commaPos = theirAnswer.indexOf(",");  
   var keyAnd = commaPos > andPos && andPos>=0;
   if(!keyAnd)theirAnswer = theirAnswer.replace(" and ", ",", theirAnswer);
   if(theirAnswer.substr(-1)===",")theirAnswer = theirAnswer.substr(0, theirAnswer.length - 1); // remove trailing ,
   if(theirAnswer.substr(0,1)===",")theirAnswer = theirAnswer.substr(1); // remove leading ,
   var theirAnswerA = theirAnswer.split(",");
   if(theirAnswerA.length==1)theirAnswerA = theirAnswer.split(" "); // if no commas, see if space separated.
   for(var i=0; i<theirAnswerA.length; i++)theirAnswerA[i] = $.trim(theirAnswerA[i]);
   return theirAnswerA;
}

/**
 * A wrapper around the original dfm_generateQuestionContent method to
 * provide error handling and reporting to Sentry.
 *
 * @param {*} div
 * @param {*} question
 * @param {*} submitHandler
 * @param {*} isAnswerInput
 * @param {*} theiranswer
 * @returns {boolean} Success or failure of the question rendering.
 */
export function dfm_generateQuestionContent(div, question, submitHandler, isAnswerInput, theiranswer) {
   try {
      /**
       * This is not ideal.
       *
       * There are parts of the API that return a dummy question object
       * rather than returning an actual error.
       *
       * To indicate the dummy question, the flag `isValid` is set to false.
       * This does mean we should avoid manipulating this flag on the client
       * side.
       *
       * An error message should be stored in the content field of the dummy
       * question object.
       */
      if (question.isValid === false) {
         throw new Error(question.content ?? "This question was rendered as invalid by the server.");
      }

      // Attach an event listener to catch errors thrown from any embedded scripts.
      let errorsThrown = 0;
      window.addEventListener("error", function (e) {
         e.preventDefault();
         errorsThrown++;
      });

      // Call the actual function to generate the question content.
      dfm_generateQuestionContentDo(div, question, submitHandler, isAnswerInput, theiranswer);

      window.removeEventListener("error");

      // If any errors were thrown, throw an error to go to the catch block.
      if (errorsThrown > 0) {
         throw new Error("An error occurred while rendering this question.");
      }

      return true;
   } catch (e) {
      console.log(e);

      // Build and render an error message in the question container provided.
      let additionalInformation = {};
      if (e.message) {
         additionalInformation.error = e.message;
      }
      if (question.subskill) {
         additionalInformation.ssid = question.subskill.ssid;
         additionalInformation.params = JSON.stringify(question.params);
      }
      if (question.qid) {
         additionalInformation.qid = question.qid;
      }
      const errorMessageHTML = buildErrorMessageHtml("This question could not be rendered.", JSON.stringify(additionalInformation));
      div.html(`<div style="margin: 16px 0;">${errorMessageHTML}</div>`);

      // Report the error to Sentry if we have a subskill or qid.
      if (question.subskill || question.qid) {
         Sentry.withScope(scope => {
            // Set a tag to allow filtering of issues affecting question rendering in Sentry UI.
            scope.setTag("question_render_failure", "true");

            // Set the context of the error.
            const context = question.subskill ? { ssid: question.subskill.ssid, params: JSON.stringify(question.params) } : { qid: question.qid };
            scope.setContext("Question Rendering Failure", context);

            // Group the same error messages for the same ssids or qids together, regardless of stack trace.
            if (question.subskill) {
               scope.setFingerprint([e.name, e.message, "subskill", question.subskill.ssid]);
            } else {
               scope.setFingerprint([e.name, e.message, "question", question.qid]);
            }

            Sentry.captureException(e);
         });
      }

      return false;
   }
}

var questionCounter = 0;

/* --------------------------------------------------------
   -- Generates the question HTML and wires up the Submit button.
   -------------------------------------------------------- */

// isAnswerInput: (0) Question only, (1) both (2) answer only
// If question.answer.theirAnswer
function dfm_generateQuestionContentDo(div, question, submitHandler, isAnswerInput, theiranswer) {
   if(theiranswer)question.answer.theirAnswer = theiranswer; // sorry, a bit hacky
   if(isAnswerInput===undefined)isAnswerInput = 1;
   questionCounter++;
   div.html("");
   if(question.answer && question.answer.type=="desmos_line")question.answer.type = "desmos"; // legacy

   // We'd like to differentiate between a fixed question and generated question.
   const questionContentClasses = question.qid ? "question-content fixed-question-content" : "question-content generated-question-content";

   var questionHTML = "<div class='" + questionContentClasses + "'>"+replaceMathsTags(question.content)+(question.marks ? "<p><strong>("+question.marks+" mark"+(question.marks!=1 ? "s" : "")+")</strong></p>" : "")+"</div>";
   var answer = question.answer;
   var answerHTML = "<div class='answer-content'>";
   if(answer)switch (answer.type) {
      case "textual":
         $.each(answer.data.rows, function(k,v){
            answerHTML+= "<div class='textual-row'>"+(answer.theirAnswer ? "" : "<img src='/homework/img/write.png'> ")+(v.before ? replaceMathsTags(v.before) : "")+" <input type='text' name='textual-answer-"+(k+1)+"' autocomplete='off'> "+(v.after ? replaceMathsTags(v.after) : "")+"</div>";
         });
         break;
      case "numeric":
         $.each(answer.data.rows, function(k,v){
            answerHTML+= "<div class='numeric-row'>"+(answer.theirAnswer ? "" : "<img src='/homework/img/write.png'> ")+(v.before ? replaceMathsTags(v.before) : "")+" <input type='text' name='numeric-answer-"+(k+1)+"' autocomplete='off'> "+(v.after ? replaceMathsTags(v.after) : "")+"</div>";
         });
         break;
      case "desmos" :
         const defaultInputGraphHeight = answer.data.mode === "boxplot" ? 120 : 400;
         const defaultInputGraphWidth = 350;
         const maxInputGraphWidth = 449;
         const inputGraphHeight = answer.data.desmosAnswerHeight ?? defaultInputGraphHeight;
         const inputGraphWidth = Math.min(maxInputGraphWidth, answer.data.desmosAnswerWidth ?? defaultInputGraphWidth);
         answerHTML+= `<div class='desmos-calculator' style='width: ${inputGraphWidth}px; height: ${inputGraphHeight}px;'></div>`;
         break;
      case "ratio":
         answerHTML+= "<div class='ratio-row'><img src='/homework/img/write.png'> ";
         for(var k=0; k<answer.data.num; k++) {
            if(k!=0)answerHTML+= " ||:|| ";
            answerHTML+= "<span class='expression-answer-ratio' autocomplete='off'></span>";
         };
         answerHTML+= "</div>";
         break;
      case "ordered":
         if(answer.theirAnswer) {
            var txtArray = [];
            for(var i=0; i<answer.theirAnswer.length; i++) {
               txtArray[answer.theirAnswer[i]-1] = replaceMathsTags(question.answer.data.items[i]);
            }
            answerHTML+= txtArray.join(", ");
         } else {
            $.each(answer.data.items, function(k,v){
               answerHTML+= "<div class='ordered-row'>"+replaceMathsTags(v)+"</div>";
            });
         }
         break;
      case "inequality":
         answerHTML+= "<div class='inequality-rows'></div>";
         answerHTML+= "<div class='inequality-add-row'><select name='inequality-add-button' style='padding:10px'>";
         answerHTML+= "<option value=''>+ Add a Range</option><option value='<'>x < ...</option><option value='<='>x &leq; ...</option><option value='>'>x > ...</option><option value='>='>x &geq; ...</option><option value='!='>x &ne; ...</option><option value='='>x = ...</option><option value='<<'>... < x < ...</option><option value='<<='>... < x &leq; ...</option><option value='<=<'>... &leq; x < ...</option><option value='<=<='>... &leq; x &leq; ...</option><option value='<>'>x<... or x>...</option><option value='<=>='>x&le;... or x&ge;...</option>";
         answerHTML+= "</select>";
         answerHTML+= "</div>";
         break;
      case "expression":
         answerHTML+= "<div class='expression-row'>"+(answer.data.before ? replaceMathsTags(answer.data.before) : "")+(answer.theirAnswer ? "" : " <img src='/homework/img/write.png'> ")+"<span id='"+(answer.theirAnswer ? "expression-correctanswer" : "expression-answer")+"'></span> "+(answer.data.after ? replaceMathsTags(answer.data.after) : "")+"</div>";
         break;
      case "list":
         answerHTML+= "<div class='list-row'>"+(answer.theirAnswer ? "" : "<p class='answer-format-note'>Separate your answers with commas</p><img src='/homework/img/write.png'> ")+(answer.data.before ? replaceMathsTags(answer.data.before) : "")+" <input type='text' name='list-answer' autocomplete='off'>"+(answer.data.after ? replaceMathsTags(answer.data.after) : "")+"</div>";
         break;
      case "shape":
         answerHTML+= "<canvas class='question-canvas dfmCanvas'></canvas>";
         break;
      case "multiplechoice":
         answerHTML+= "<div class='multiplechoice-container'>";
         $.each(answer.data.options, function(k, v){
            const inputType = answer.data.multiple ? "checkbox" : "radio";
            answerHTML +=
               `<div class="multiplechoice-row">
                  <input class="multiplechoice-input" type="${inputType}" ${answer.theirAnswer ? "disabled" : ""} name="multiplechoice-answer[]" value="${(k + 1)}" id="ma${(k + 1)}">
                  <label class="multiplechoice-label" for="ma${(k+1)}">${replaceMathsTags(v)}</label>
               </div>`;
         });
         answerHTML+= "</div>";
         break;
      case "fraction":
         answerHTML+= "<div class='fraction-row'>"+(answer.data.before ? replaceMathsTags(answer.data.before) : "")+" ";
         if(answer.data.type=="mixed")answerHTML+= "<input type='text' class='fraction-whole' name='fraction-whole' autocomplete='off'> ";
         answerHTML+= "<span><span class='fraction-numercontainer'><input type='text' class='fraction-numer' name='fraction-numer' autocomplete='off'></span><br><input type='text' class='fraction-denom' name='fraction-denom' autocomplete='off'></span> ";
         answerHTML+= (answer.data.after ? replaceMathsTags(answer.data.after) : "")+"</div>";
         break;
      case "coordinate":
         answerHTML+= "<div class='coordinate-row'>"+(answer.data.before ? replaceMathsTags(answer.data.before) : "")+" ";
         answerHTML+= "<span class='coordinate-bracket'>||(||</span> <span class='expression-answer-x'></span> ";
         answerHTML+= "<span class='coordinate-bracket'>||,||</span> <span class='expression-answer-y'></span> ";
         if(answer.data.dimensions==3)answerHTML+= "<span class='coordinate-bracket'>||,||</span> <span class='expression-answer-z'></span> ";
         answerHTML+= "<span class='coordinate-bracket'>||)||</span> ";
         answerHTML+= (answer.data.after ? replaceMathsTags(answer.data.after) : "")+"</div>";
         break;
      case "vector":
         answerHTML+= "<div class='vector-row'>"+(answer.data.before ? replaceMathsTags(answer.data.before) : "")+" ";
         answerHTML+= "<span class='vector-bracket'>||(||</span> <span class='matrix'>";
         for(var r=1; r<=answer.data.rows; r++) {
            for(var c=1; c<=answer.data.cols; c++) {
               answerHTML+= "<span class='expression-answer-cell'></span> ";
            }
            if(r!=answer.data.rows)answerHTML+= "<br>";
         }
         answerHTML+= "</span>";
         answerHTML+= "<span class='vector-bracket'>||)||</span> ";
         answerHTML+= (answer.data.after ? replaceMathsTags(answer.data.after) : "")+"</div>";
         break;
      case "table":
         const tableClass = answer.data.tablestyle ?? "gdptable";
         const maybePlaceholder = answer.data.type === "list" ? "placeholder='Separate answers with commas.'" : ""
         let fixedVals = answer.data.fixedVals ?? [];

         // Set the width of table input fields.
         const defaultWidth = "70px";
         let tInputWidth = defaultWidth;
         if (tableClass === "columnoperations") {
            tInputWidth = "30px";
         } else if (answer.data.type === "list") {
            tInputWidth = "320px";
         } else if (answer.data.type === "textual") {
            tInputWidth = "90px";
         }

         // Set additional variables needed for columnoperations table style.
         const maxLengthAttribute = tableClass === "columnoperations" ? "maxlength='1'" : "";
         const horizontalLines = tableClass === "columnoperations" ? (answer.data.horizontalLines ?? []) : [];
         const inputClass = tableClass === "columnoperations" ? "class='columnoperations-input'" : "";

         answerHTML+= `<table class='${tableClass}'>`;

         let generateRow = function(r, isHeader) {
            const cellTag = isHeader ? "th" : "td";
            const rowClass = horizontalLines.includes(r)
               ? "after-horizontal-line"
               : horizontalLines.includes(r - 1)
               ? "before-horizontal-line"
               : "";

            let rowHtml = rowClass ? `<tr class='${rowClass}'>` : "<tr>";
            for (let c = 0; c < answer.data.cols; c++) {
               if (fixedVals.length > r && fixedVals[r].length > c && fixedVals[r][c] !== '') {
                  rowHtml+= `<${cellTag}>${replaceMathsTags(fixedVals[r][c])}</${cellTag}>`;
               } else {
                  rowHtml+= `<${cellTag}><input ${inputClass} ${maxLengthAttribute} type='text' style='width:${tInputWidth}' name='table-answer-${r+1}-${c+1}' autocomplete='off' ${maybePlaceholder}></${cellTag}>`;
               }
            }
            rowHtml+= "</tr>";
            return rowHtml;
         }

         if (answer.data.firstRowIsHeader) {
            answerHTML += "<thead>";
            answerHTML += generateRow(0, true);
            answerHTML += "</thead>";
         }

         answerHTML+= "<tbody>";
         const firstBodyRowNum = answer.data.firstRowIsHeader ? 1 : 0;
         for (let r = firstBodyRowNum; r < answer.data.rows; r++) {
            answerHTML += generateRow(r, false);
         }
         answerHTML+= "</tbody></table>";
         break;
      case "standardform":
         answerHTML+= "<div class='standardform-row'>";
         answerHTML+= (answer.data.before ? replaceMathsTags(answer.data.before) : "")+" <span class='expression-answer-main'></span> <span class='standardform-text'>||\\times 10||</span> <span class='expression-answer-power'></span> "+(answer.data.after ? replaceMathsTags(answer.data.after) : "");
         answerHTML+= "</div>";
         break;
      case "ordered":
         break;
      case "eqnsolutions":
         answerHTML+= "<div class='solution-rows'>";
         var isInequalityQn = answer.data.isInequality;
         for(var i=0; i<answer.data.numSlns; i++) {
            answerHTML+= "<div class='solution-row'>";
            if(answer.theirAnswer)answerHTML+="<div>"; // override css > span
            answerHTML+= "<label class='eqnsolutions-connector'>"+(i!=0 ? answer.data.connector : "")+"</label>";
            for(var j=0; j<answer.data.vars.length; j++) {
               if(j!=0)answerHTML+= ", ";
               if(answer.theirAnswer && answer.theirAnswer[i][j])answerHTML+= "||"+answer.data.vars[j]+answer.theirAnswer[i][j].operator+answer.theirAnswer[i][j].answer+"||";
               else answerHTML+= "<span style='"+(isInequalityQn ? "width:300px" : "")+"'><label>||"+answer.data.vars[j]+(!isInequalityQn ? "=" : "")+"||</label>"+(!isInequalityQn ? "" : "<select><option value='='>=</option><option value='<'>&lt;</option><option value='<='>&le;</option><option value='>'>&gt;</option><option value='>='>&ge;</option><option value='!='>&ne;</option></select>")
                 +" <span class='eqnsolutions-answerinput'></span></span>";
            }
            if(answer.theirAnswer)answerHTML+="</div>";
            answerHTML+= "</div>";
         }
         answerHTML+= "</div>";
         break;
   }
   answerHTML+= "</div>";

   var buttonHTML = !answer||answer.theirAnswer ? "" : "<input type='submit' value='"+(answer.type==="none" ? "Reveal Solution" : "Submit Answer")+"'>";
   var c;
   if(isAnswerInput==0)c = questionHTML;
   else if(answer.type==="none")c = questionHTML + buttonHTML;
   else if(isAnswerInput==1)c = questionHTML + answerHTML+buttonHTML;
   else c = answerHTML+buttonHTML;
   // div.append("<form action='#' method='post' id='question-form-"+questionCounter+"' class='question-form'>"+c+"</form>");
   div.append("<form action='#' method='post' id='question-form-"+questionCounter+"' class='question-form'></form>");
   
   // console.log("Question content: "+questionHTML+" Answer HTML: "+answerHTML);

   if(isAnswerInput==0) {
      div.children('form').append(questionHTML);
   } else if(isAnswerInput==1) {
      div.children('form').append(questionHTML);
      div.children('form').append(answerHTML);
      div.children('form').append(buttonHTML);
   } else {
      div.children('form').append(answerHTML);
      div.children('form').append(buttonHTML);
   }

   // -------------------------------------
   // -- Any stuff to do to input fields after HTML generated.
   // -------------------------------------

   if(answer && answer.theirAnswer) {
      $("#question-form-" + questionCounter + " .answer-content").prepend("<p class='theiranswer-label' style='margin:0px;font-size:11px;font-weight:bold'>" + (Context.user.accounttype == "teacher" || Context.user.accounttype == "admin" ? "Their" : "Your") + " Answer:</p>");

      if(answer.correctAnswer) {
         $("#question-form-"+questionCounter+" .answer-content").children().wrapAll("<div class='theiranswer'></div>");
         $("#question-form-"+questionCounter+" .answer-content").prepend("<div class='correctanswer'><p class='correctanswer-label' style='margin:0px;font-size:11px;font-weight:bold'>Correct Answer:</strong></p>"+showHTMLAnswer(question, answer.correctAnswer)+"</div>");
         if(answer.type=="desmos") {
            // Showing correct answer, e.g. on Progress interface.
            $("#question-form-"+questionCounter+" .answer-content").find('.desmos-calculator-solution').dfmDesmosLine({
               answerData: answer.data,
               answer: answer.correctAnswer
            });
         }
      }
      if(answer.type=="shape") {
         $("#question-form-"+questionCounter+" .answer-content").find('canvas.solution-canvas').dfmCanvas({
            editMode:false,
            readOnly:true,
            answerData: answer.data,
            answer: answer.correctAnswer
         });
      }
   }
   if(answer)switch (answer.type) {
      case "textual" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .textual-row input").hide();
            $("#question-form-"+questionCounter+" .textual-row input").each(function(k) {
               $(this).after("<span><strong>"+stripTags(answer.theirAnswer[k])+"</strong></span>");
            });
         }
         break;
      case "numeric" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .numeric-row input").hide();
            $("#question-form-"+questionCounter+" .numeric-row input").each(function(k) {
               $(this).after("<span>"+stripTags(answer.theirAnswer[k])+"</span>");
            });
         }
         break;
      case "ordered" :
         $("#question-form-"+questionCounter+" .answer-content").sortable();
         $("#question-form-"+questionCounter+" .answer-content").children().each(function(i){
            $(this).data("order", i+1);
         });
         break;
      case "ratio" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .ratio-row").html("||"+$.map(answer.theirAnswer, function(x){ stripTags(x) }).join(":")+"||");
         } else {
            $("#question-form-"+questionCounter+" .expression-answer-ratio").each(function(){   
               $(this).algebraicInput("handlers", {
                  enter: function(){ 
                     $("#question-form-"+questionCounter).submit();
                  }
               });
            });
         }
         break;
      case "multiplechoice" :
         if(answer.theirAnswer && !answer.data.multiple) {
            $("#question-form-"+questionCounter+" .multiplechoice-row input").each(function(v){
               if($(this).val()==answer.theirAnswer)$(this).prop("checked",true);
            });
         }
         if(answer.theirAnswer && answer.data.multiple) {
            $("#question-form-"+questionCounter+" .multiplechoice-row input").each(function(v){
               if($.inArray(parseInt($(this).val()),answer.theirAnswer)>=0)$(this).prop("checked",true);
            });
         }
         if(!answer.theirAnswer)$("#question-form-"+questionCounter+" .multiplechoice-row").click(function(){
            if(answer.data.multiple)$(this).find('input[type=checkbox]').prop('checked', !$(this).find('input[type=checkbox]').prop('checked'));
            else $(this).find('input[type=radio]').prop('checked', true);
         });
         $("#question-form-"+questionCounter+" .multiplechoice-row label").click(function(e){
            e.preventDefault(); 
         });
         if(!answer.theirAnswer)$("#question-form-"+questionCounter+" .multiplechoice-row input[type=checkbox]").click(function(e){
            if(answer.data.multiple)$(this).prop('checked', !$(this).prop('checked'));
         });
         break;
      case "inequality" :
         $("#question-form-"+questionCounter+" select[name=inequality-add-button]").children().each(function(i) {
            $(this).html(  $(this).html().replaceAll("x", makeLatexPlainText(answer.data.vars[0])) );
         });
         $("#question-form-"+questionCounter+" select[name=inequality-add-button]").data('questionCounter', questionCounter);
         $("#question-form-"+questionCounter+" select[name=inequality-add-button]").change(function(){
            if(!$(this).val())return;
            var questionCounter = $(this).data('questionCounter');
            // Temporarily assume there's just one variable.
            if($(this).val()=="<>") {
               addInequalityInputRow("<", $("#question-form-"+questionCounter), answer.data.vars[0]);
               addInequalityInputRow(">", $("#question-form-"+questionCounter), answer.data.vars[0]);
            } else if($(this).val()=="<=>=") {
               addInequalityInputRow("<=", $("#question-form-"+questionCounter), answer.data.vars[0]);
               addInequalityInputRow(">=", $("#question-form-"+questionCounter), answer.data.vars[0]);
            } else {
               addInequalityInputRow($(this).val(), $("#question-form-"+questionCounter), answer.data.vars[0]);
            }
            $(this).val("");
         });
         if(answer.theirAnswer) {
            $.each(answer.theirAnswer, function(k, range) {
               addInequalityInputRow(range.op, $("#question-form-"+questionCounter), answer.data.vars[0]);
               if (range.args) {
                  if (range.args.length == 2) $("#question-form-" + questionCounter).find('.inequality-rows').eq(k).find('.ineqarg-left').html("||" + range.args[0] + "||");
                  $("#question-form-" + questionCounter).find('.inequality-rows').eq(k).find('.ineqarg-right').html("||" + range.args[range.args.length - 1] + "||");
               }
               
            });
            $("#question-form-"+questionCounter).find('select[name=inequality-add-button]').remove();
            $("#question-form-"+questionCounter).find('a').remove(); // the delete symbols
         }
         break;
      case "expression" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .expression-row span").html("||"+stripTags(answer.theirAnswer)+"||");
         } else {
            $("#question-form-"+questionCounter+" .expression-row span").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
         }
         break;

      case "table" : 
        if(answer.theirAnswer) {
           for(var r=1; r<=answer.data.rows; r++) {
              for(var c=1; c<=answer.data.cols; c++) {
                 if(answer.theirAnswer[r-1][c-1]!="") {
                    $("#question-form-"+questionCounter+" input[name=table-answer-"+r+"-"+c+"]").parent().css('background-color','black');
                    $("#question-form-"+questionCounter+" input[name=table-answer-"+r+"-"+c+"]").parent().css('color','white');
                    $("#question-form-"+questionCounter+" input[name=table-answer-"+r+"-"+c+"]").parent().html("||"+stripTags(answer.theirAnswer[r-1][c-1])+"||");
                 }
              }
           }
        }
        break;

      case "coordinate" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .expression-answer-x").html("||"+stripTags(answer.theirAnswer.x)+"||");
            $("#question-form-"+questionCounter+" .expression-answer-y").html("||"+stripTags(answer.theirAnswer.y)+"||");
            $("#question-form-"+questionCounter+" .expression-answer-z").html("||"+stripTags(answer.theirAnswer.z)+"||");
         } else {
            $("#question-form-"+questionCounter+" .expression-answer-x").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
            $("#question-form-"+questionCounter+" .expression-answer-y").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
            $("#question-form-"+questionCounter+" .expression-answer-z").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
         }
         break;
      case "vector" :
         if(answer.theirAnswer) {
            var matrixLatex = "";
            for(var r=0; r<answer.theirAnswer.length; r++) {
               if(r!=0)matrixLatex+= " \\\\ ";
               matrixLatex+= $.map(answer.theirAnswer[r], function(x) { return stripTags(x) }).join(" && ");
            }
            $("#question-form-"+questionCounter+" .matrix").html("||\\begin{matrix}"+matrixLatex+"\\end{matrix}||");
         } else {
            $("#question-form-"+questionCounter+" .expression-answer-cell").each(function(){
                  $(this).algebraicInput("handlers", {enter: function(){ 
                     $("#question-form-"+questionCounter).submit();
                  }});
            });
         }
         break;
      case "fraction":
         // Adjust the width of the input boxes based on the length of the input.
         const calculateWidth = (length) => Math.max(40, Math.min((length + 2) * 10.5, 200)) + 'px';
         $(".fraction-numer, .fraction-denom").on("input", function() {
            const numerElem = $(".fraction-numer")[0];
            const denomElem = $(".fraction-denom")[0];
            const maxNumerDenomWidth = calculateWidth(Math.max(numerElem.value.length,denomElem.value.length));
            numerElem.style.width = maxNumerDenomWidth;
            denomElem.style.width = maxNumerDenomWidth;
         });
         $(".fraction-whole").on("input", function() {
            const wholeElem = $(".fraction-whole")[0];
            const wholeWidth = calculateWidth(wholeElem.value.length);
            wholeElem.style.width = wholeWidth;
         });

         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .fraction-row").html("||"+(answer.theirAnswer.whole ? stripTags(answer.theirAnswer.whole) : "")+"\\frac{"+stripTags(answer.theirAnswer.numer)+"}{"+stripTags(answer.theirAnswer.denom)+"}||");
         }
         break;
      case "standardform" :
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .standardform-row").html("||{"+stripTags(answer.theirAnswer.main)+"}\\times 10^{"+stripTags(answer.theirAnswer.power)+"}||")
         } else {
            $("#question-form-"+questionCounter+" .expression-answer-main").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
            $("#question-form-"+questionCounter+" .expression-answer-power").algebraicInput("handlers", {enter: function(){ 
               $("#question-form-"+questionCounter).submit();
            }});
         }
         break;
      case "list":
         if(answer.theirAnswer) {
            $("#question-form-"+questionCounter+" .list-row input").hide();
            $("#question-form-"+questionCounter+" .list-row input").after("<span>"+stripTags(answer.theirAnswer)+"</span>");
         }
         break;
      case "shape" :
         if(!answer.theirAnswer)$("#question-form-"+questionCounter+" .answer-content").find('canvas.question-canvas').dfmCanvas({
            editMode:false,
            answerData: answer.data
         });
         else $("#question-form-"+questionCounter+" .answer-content").find('canvas.question-canvas').dfmCanvas({
            editMode: false,
            readOnly: true,
            answerData: answer.data,
            answer: answer.theirAnswer
         });
         break;
      case "eqnsolutions" :
         if(!answer.theirAnswer)$("#question-form-"+questionCounter+" .eqnsolutions-answerinput").each(function(){
            $(this).algebraicInput(); 
         });
         else {
            console.log(JSON.stringify(answer.theirAnswer));
         }
         if(answer.data.numSlns==1)$("#question-form-"+questionCounter+" .eqnsolutions-connector").hide();
         break;
      case "desmos" :
         var elt = $("#question-form-"+questionCounter+" .desmos-calculator")[0];
         var showGrid = answer.data.showGrid!=undefined ? answer.data.showGrid : true;
         var options = !showGrid ? { expressions: false, lockViewport:true, settingsMenu: false, showGrid: false, showXAxis: false, showYAxis: false, xAxisNumbers:false, yAxisNumbers:false, border:false, trace:false }
                  : { expressions: false, lockViewport:true, settingsMenu: false, showGrid: true, xAxisNumbers:showGrid && answer.data.mode!="barchart", yAxisNumbers:showGrid, xAxisArrowMode:'POSITIVE', yAxisArrowMode:'POSITIVE', xAxisLabel: answer.data.xaxis.label ? answer.data.xaxis.label : 'x', yAxisLabel: !answer.data.yaxis ? '' : (answer.data.yaxis.label ? answer.data.yaxis.label : 'y'), 'xAxisStep': answer.data.xaxis.step ? answer.data.xaxis.step : 1, 'yAxisStep': answer.data.yaxis && answer.data.yaxis.step ? answer.data.yaxis.step : 5, border:false, trace:false, };
         var calculator = Desmos.GraphingCalculator(elt, options);
         $("#question-form-"+questionCounter+" .desmos-calculator").data("calculator", calculator);

         var xWidth = parseFloat(answer.data.xaxis.to) - parseFloat(answer.data.xaxis.from);
         var yWidth = answer.data.yaxis ? (parseFloat(answer.data.yaxis.to) - parseFloat(answer.data.yaxis.from)) : 0;

         // Compile the additional expressions to be rendered on the answer input graph.
         const expressions = [
            { data: answer.data.nonanswershapes, prefix: 'extra'},
            { data: answer.data.expressionsOnlyOnQuestion, prefix: 'extraQus'},
         ];
         // Render each of the expressions onto the graph.
         expressions.forEach(({ data, prefix }) => {
            if (data) {
               data.forEach((expression, index) => {
                  expression.id = `${prefix}${index}`;
                  calculator.setExpression(expression);
               });
            }
         });

         if(!div.data("repressInput")) {

         if(answer.data.mode==="multiline") {
            answer.data.mode="geometric"; // legacy renaming
            answer.data.submode = "multiline";
         }

         if(answer.data.mode=="geometric") {

            // Legacy corrections.
            if (answer.data.subtype != undefined && answer.data.submode == undefined) {
               answer.data.submode = answer.data.subtype; // legacy renaming
            }
            if (answer.data.closed) {
               answer.data.submode = "polygon"; // subtype may be missing for legacy reasons.
            }
            if (answer.data.submode == undefined) {
               answer.data.submode = "points";
            }

            // Set the interval to be used in calculating default positions for points.
            const isPolygonSubmode = answer.data.submode === "polygon";
            const interval = isPolygonSubmode ? 1 / (0.5 * answer.data.numpoints + 1) : 1 / (answer.data.numpoints + 1);

            // Get the array of any initial points provided by the QG.
            const initialPoints =  Array.isArray(answer.data.initialPoints) ? answer.data.initialPoints : [];

            // Loop through the number of points and set the Desmos expressions for each.
            for (let i = 1; i <= answer.data.numpoints; i++) {

               // Set a default position for the point.
               const multiplierX = isPolygonSubmode && i >= Math.ceil(answer.data.numpoints / 2) + 1 ? answer.data.numpoints + 1 - i : i;
               const defaultX = parseFloat(answer.data.xaxis.from) + xWidth * interval * multiplierX;
               const roundedDefaultX = Math.round(defaultX * 100) / 100;
               const multiplierY = isPolygonSubmode && i >= Math.ceil(answer.data.numpoints / 2) + 1 ? answer.data.numpoints + 0.3 - i : i;
               const defaultY = parseFloat(answer.data.yaxis.from) + yWidth * interval * multiplierY;
               const roundedDefaultY = Math.round(defaultY * 100) / 100;

               // Set the initial point if it has been defined in the QG, falling back to the default set above.
               const initialPoint = typeof initialPoints[i - 1] === "object" ? initialPoints[i - 1] : {};
               const {
                  x: initialX = roundedDefaultX,
                  y: initialY = roundedDefaultY,
                  dragMode = "AUTO"
               } = initialPoint;

               // If we have been provided with the user answer, use this instead of the initial point and disable drag mode.
               const pointToUseX = answer.theirAnswer ? answer.theirAnswer[i - 1].x : initialX;
               const pointToUseY = answer.theirAnswer ? answer.theirAnswer[i - 1].y : initialY;
               const dragModeToUse = answer.theirAnswer ? "NONE" : dragMode;

               // Set the expression for the x and y values.
               calculator.setExpression({ id: 'aX' + i, latex: 'x_' + i + '=' + pointToUseX,  color: '#000'});
               calculator.setExpression({ id: 'aY' + i, latex: 'y_' + i + '=' + pointToUseY,  color: '#000'});

               // Set the expression for the point from the x and y values, using the drag mode specified above.
               const point = { id: 'aXY' + i, latex: 'P_' + i + '=\\left(x_' + i + ', y_' + i + '\\right)', color: '#000', dragMode: dragModeToUse };
               if (Array.isArray(answer.data.labels) && answer.data.labels[i - 1]) {
                  point.showLabel = true;
                  point.label = answer.data.labels[i - 1];
               }
               calculator.setExpression(point);

               // Set up any slider bounds that have been defined in the QG.
               if (answer.data.sliderBounds) {
                  const { xMin, xMax, xStep, yMin, yMax, yStep } = answer.data.sliderBounds;

                  // Helper function to create slider bounds.
                  const createSliderBounds = (min, max, step) => ({
                     ...(min !== undefined && { min }),
                     ...(max !== undefined && { max }),
                     ...(step !== undefined && { step })
                  });

                  // Set X slider bounds.
                  calculator.setExpression({
                     id: 'aX' + i,
                     sliderBounds: createSliderBounds(xMin, xMax, xStep)
                  });

                  // Set Y slider bounds.
                  calculator.setExpression({
                     id: 'aY' + i,
                     sliderBounds: createSliderBounds(yMin, yMax, yStep)
                  });
               }
            }

            // Set the expressions that connect the points, dependent on the submode.

            if(answer.data.submode!="points") {
               for(var i=2; i<=answer.data.numpoints; i++) {
                  calculator.setExpression({ id: 'line'+i, latex: '\\left(x_'+(i-1)+', y_'+(i-1)+'\\right), \\left(x_'+i+', y_'+i+'\\right)',  color: 'black', lines: true, points: false});
               }
            }

            if(answer.data.submode=="polygon") {
               calculator.setExpression({ id: 'lineC', latex: '\\left(x_'+answer.data.numpoints+', y_'+answer.data.numpoints+'\\right), \\left(x_1, y_1\\right)',  color: 'black', lines: true, points: false});
               var allPointsStr = [];
               for(var i=1; i<=answer.data.numpoints; i++)allPointsStr.push('\\left(x_'+i+', y_'+i+'\\right)');
               calculator.setExpression({ id: 'fillC', latex: '\\operatorname{polygon}\\left('+allPointsStr.join(", ")+'\\right)',  color: 'black', lines: false, points: false, fill: true, fillOpacity: 0.5});
            }
  
         } else if(answer.data.mode=="boxplot") {

           var boxPlotIds = ["min", "q1", "q2", "q3", "max"];
           if(!answer.theirAnswer) {
              var interval = 1/(5+1);
              for(var i=0; i<5; i++) {
                 calculator.setExpression({ id: 'aX'+i, latex: 'x_'+(i+1)+'='+(parseFloat(answer.data.xaxis.from) + xWidth*interval*(i+1)),  color: '#000'});
                 calculator.setExpression({ id: boxPlotIds[i], latex: '\\left(x_'+(i+1)+', 2.5\\right)',  color: '#000'});
               }
            } else {
              for(var i=0; i<5; i++) {
                 calculator.setExpression({ id: 'aX'+i, latex: 'x_'+(i+1)+'='+answer.theirAnswer[i],  color: '#000'});
                 calculator.setExpression({ id: boxPlotIds[i], latex: '\\left(x_'+(i+1)+', 2.5\\right)',  color: '#000'});
              }
            }
            // Connecting lines on box plot:
            calculator.setExpression({ id: 'a1', latex: 'y=2.5\\left\\{\\left[x_1,x_4\\right]\\le x\\le\\left[x_2,x_5\\right]\\right\\}',  color: 'black'});
            calculator.setExpression({ id: 'a2', latex: 'x=\\left[x_1,x_2,x_3,x_4, x_5\\right]\\left\\{1.5\\le y\\le 3.5\\right\\}',  color: 'black'});
            calculator.setExpression({ id: 'a3', latex: 'y=\\left[3.5,1.5\\right]\\left\\{x_2\\le x\\le x_4\\right\\}',  color: 'black'});
	
         } else if(answer.data.mode=="barchart") {

            var answerShapesSeen = 0;
            for(var i=0; i<answer.data.bars.length; i++) {
               answer.data.bars[i].id = 'extra'+i;

               var isAnswer = !answer.data.bars[i].frequency;
               var freq = isAnswer ? 1 : answer.data.bars[i].frequency;
               var color = answer.data.bars[i].color ? answer.data.bars[i].color : 'blue';
               if(isAnswer && !answer.data.bars[i].color)color = 'black'; // default colour of input bars is black
               if(isAnswer)
               {
                  if(answer.theirAnswer)calculator.setExpression({ id: 'aY'+answerShapesSeen, latex: 'y_'+(answerShapesSeen+1)+'='+answer.theirAnswer[answerShapesSeen],  color: '#000'});
                  else calculator.setExpression({ id: 'aY'+answerShapesSeen, latex: 'y_'+(answerShapesSeen+1)+'='+1,  color: '#000'});
                  calculator.setExpression({ id: 'inputpoint'+answerShapesSeen, latex: '\\left('+(i+0.5)+', y_'+(answerShapesSeen+1)+'\\right)',  color: '#000'});
                  answerShapesSeen++;
               }

               var points = [];
               points.push("("+(i + 0.25)+",0)");
               points.push("("+(i + 0.75)+",0)");
               points.push("("+(i + 0.75)+"," + (isAnswer ? 'y_'+answerShapesSeen : freq)+")");
               points.push("("+(i + 0.25)+"," + (isAnswer ? 'y_'+answerShapesSeen : freq)+")");

               calculator.setExpression({ id: 'fillC'+i, latex: '\\operatorname{polygon}\\left('+points.join(", ")+'\\right)',  color: color, lines: false, points: false, fill: true, fillOpacity: isAnswer ? 0.5 : 0.8});
               calculator.setExpression({ id: 'label'+i, latex: '('+(i+0.5)+',-0.5)',  color: color, showLabel: true, hidden: true, label: answer.data.bars[i].label});

            }

         } else if(answer.data.mode==="circle") {

            if (!answer.theirAnswer) {
               calculator.setExpression({ id: 'v1', latex: 'a=1',  color: 'black'});
               calculator.setExpression({ id: 'v2', latex: 'b=1',  color: 'black'});
               calculator.setExpression({ id: 'v3', latex: 'c=2.5',  color: 'black'});
               calculator.setExpression({ id: 'v4', latex: 'd=2.5',  color: 'black'});
            } else {
               calculator.setExpression({ id: 'v1', latex: 'a='+answer.theirAnswer.centre.x,  color: 'black'});
               calculator.setExpression({ id: 'v2', latex: 'b='+answer.theirAnswer.centre.y,  color: 'black'});
               calculator.setExpression({ id: 'v3', latex: 'c='+answer.theirAnswer.point.x,  color: 'black'});
               calculator.setExpression({ id: 'v4', latex: 'd='+answer.theirAnswer.point.y,  color: 'black'});
            }

            calculator.setExpression({ id: 'a1', latex: '\\left(a,b\\right)',  color: 'black'});
            calculator.setExpression({ id: 'a2', latex: '\\left(c,d\\right)',  color: 'black'});
            calculator.setExpression({ id: 'a3', latex: '\\left(x-a\\right)^{2}+\\left(y-b\\right)^{2}=\\left(c-a\\right)^{2}+\\left(d-b\\right)^{2}',  color: 'black'});
	
         } else if ([1,2,3].includes(answer.data.order)) {
            /**
             * Note:
             *
             * This block is for "mode" = "polynomial" but the previous implementation only
             * checked the "order" property and as such, not all QGs that specify an "order"
             * actually have "mode" = "polynomial". This is most likely because it would
             * have worked without needing to set the "mode" property :-/
             *
             * However, all of these QGs do have an order of an integer 1, 2 or 3 specified
             * so we will continue to use this as the check.
             */

            // Get the order of the polynomial specified (1 - linear, 2 - quadratic, 3 - cubic).
            const orderSpecified = answer.data.order;

            // Get the array of any initial points provided by the QG.
            const initialPoints = Array.isArray(answer.data.initialPoints) ? answer.data.initialPoints : [];

            // There should be one more initial point than the order specified (e.g. a linear graph requires two points).
            for (let i = 1; i <= orderSpecified + 1; i++) {
               // Set a default position for the point, which requires a multiplier conditional on the order specified.
               let multiplierX = 0.2;
               let multiplierY = 0.2;
               // The logic for these calculations is based on the previous implementation and cannot be explained.
               if (orderSpecified === 1) {
                  multiplierX = i === 1 ? 0.2 : 0.6;
                  multiplierY = i === 1 ? 0.2 : 0.6;
               } else if (orderSpecified === 2) {
                  multiplierX = 0.2 * (i + 1);
                  multiplierY = 0.6 - 0.2 * i;
               } else if (orderSpecified === 3) {
                  multiplierX = 0.15 * (i + 1);
                  multiplierY = i % 2 == 0 ? 0.6 : 0.4;
               }
               const initialDefaultX = parseFloat(answer.data.xaxis.from) + xWidth * multiplierX
               const initialDefaultY = parseFloat(answer.data.yaxis.from) + yWidth * multiplierY;

               // Set the initial point if it has been defined in the QG, falling back to the default set above.
               const initialPoint = typeof initialPoints[i - 1] === "object" ? initialPoints[i - 1] : {};
               const {
                  x: initialX = initialDefaultX,
                  y: initialY = initialDefaultY,
                  dragMode = "AUTO"
               } = initialPoint;

               // If we have been provided with the user answer, use this instead of the initial point and disable drag mode.
               const pointToUseX = answer.theirAnswer ? answer.theirAnswer[i - 1].x : initialX;
               const pointToUseY = answer.theirAnswer ? answer.theirAnswer[i - 1].y : initialY;
               const dragModeToUse = answer.theirAnswer ? "NONE" : dragMode;

               // Set the expression for the initial x and y values.
               calculator.setExpression({ id: 'aX' + i, latex: 'x_' + i + '=' + pointToUseX, color: '#000' });
               calculator.setExpression({ id: 'aY' + i, latex: 'y_' + i + '=' + pointToUseY, color: '#000' });

               // Set the expression for the point from the initial x and y values, using the drag mode specified above.
               calculator.setExpression({ id: 'aXY' + i, latex: '\\left(x_' + i + ', y_' + i + '\\right)', color: '#000', dragMode: dragModeToUse });
            }

            // Set the order specific expressions to draw the relevant graph. The expressions reference the points defined above.
            if (orderSpecified === 1) {
               calculator.setExpression({ id: 'function', latex: 'f\\left(x\\right)=ax + b',  color: '#000'});
               calculator.setExpression({ id: 'function1', latex: 'a=\\frac{y_{2} - y_{1}}{x_{2} - x_{1}}',  color: '#000'});
               calculator.setExpression({ id: 'function2', latex: 'b=\\y_{1} - a \\cdot x_{1}',  color: '#000'});
            } else if (orderSpecified === 2) {
               calculator.setExpression({ id: 'function', latex: 'f\\left(x\\right)=ax^{2}+bx+c',  color: '#000'});
               calculator.setExpression({ id: 'function1', latex: 'A_{1}=-x_{1}^{2}+x_{2}^{2}',  color: '#000'});
               calculator.setExpression({ id: 'function2', latex: 'B_{1}=-x_{1}+x_{2}',  color: '#000'});
               calculator.setExpression({ id: 'function3', latex: 'D_{1}=-y_{1}+y_{2}',  color: '#000'});
               calculator.setExpression({ id: 'function4', latex: 'A_{2}=-x_{2}^{2}+x_{3}^{2}',  color: '#000'});
               calculator.setExpression({ id: 'function5', latex: 'B_{2}=-x_{2}+x_{3}',  color: '#000'});
               calculator.setExpression({ id: 'function6', latex: 'D_{2}=-y_{2}+y_{3}',  color: '#000'});
               calculator.setExpression({ id: 'function7', latex: 'B_{multiplier}=-\\left(\\frac{B_{2}}{B_{1}}\\right)',  color: '#000'});
               calculator.setExpression({ id: 'function8', latex: 'A_{3}=B_{multiplier}\\cdot A_{1}+A_{2}',  color: '#000'});
               calculator.setExpression({ id: 'function9', latex: 'D_{3}=B_{multiplier}\\cdot D_{1}+D_{2}',  color: '#000'});
               calculator.setExpression({ id: 'function10', latex: 'a=\\frac{D_{3}}{A_{3}}',  color: '#000'});
               calculator.setExpression({ id: 'function11', latex: 'b=\\frac{D_{1}-A_{1}\\cdot a}{B_{1}}',  color: '#000'});
               calculator.setExpression({ id: 'function12', latex: 'c=y_{1}-ax_{1}^{2}-bx_{1}',  color: '#000'});
            } else if (orderSpecified === 3) {
               calculator.setExpression({ id: 'function1', latex: 'f\\left(x\\right)= \\left( \\left( a\\left(x\\right) \\cdot \\frac{y_1}{a\\left(x_1\\right)} \\right)  + \\left( b\\left(x\\right) \\cdot \\frac{y_2}{b\\left(x_2\\right)} \\right)  + \\left( c\\left(x\\right) \\cdot \\frac{y_3}{c\\left(x_3\\right)} \\right) + d\\left(x\\right) \\cdot \\frac{y_4}{d\\left(x_4\\right)} \\right)  ',  color: '#000'});
               calculator.setExpression({ id: 'function2', latex: 'a\\left(x\\right)= \\left(x - x_2\\right)\\left(x - x_3\\right)\\left(x - x_4\\right)' , hidden: true});
               calculator.setExpression({ id: 'function3', latex: 'b\\left(x\\right)= \\left(x - x_1\\right)\\left(x - x_3\\right)\\left(x - x_4\\right)' , hidden: true });
               calculator.setExpression({ id: 'function4', latex: 'c\\left(x\\right)= \\left(x - x_1\\right)\\left(x - x_2\\right)\\left(x - x_4\\right)' , hidden: true });
               calculator.setExpression({ id: 'function5', latex: 'd\\left(x\\right)= \\left(x - x_1\\right)\\left(x - x_2\\right)\\left(x - x_3\\right)' , hidden: true });
            }
         }
         } // end if repressInput

         if(answer.data.mode==="boxplot")calculator.setMathBounds({left: parseFloat(answer.data.xaxis.from), right: parseFloat(answer.data.xaxis.to), bottom: -1.3, top: 4});
         else if(answer.data.mode==="barchart")calculator.setMathBounds({left: -0.2, right: answer.data.bars.length + 0.5, bottom: parseFloat(answer.data.yaxis.from), top: parseFloat(answer.data.yaxis.to)});
         else calculator.setMathBounds({left: parseFloat(answer.data.xaxis.from), right: parseFloat(answer.data.xaxis.to), bottom: parseFloat(answer.data.yaxis.from), top: parseFloat(answer.data.yaxis.to)});


         $("#question-form-"+questionCounter+" .desmos-calculator").data("calculator", calculator);
         break;

   }

   if(!submitHandler)submitHandler = function(event){ return localQuestionMarkerHandler(question, questionCounter) };
   div.find('form').submit(function(event) {
      // $("#question-form-"+questionCounter).find('input[type=submit]').val('Submitting...');
      $(this).find('input[type=submit]').prop('disabled', true); // $("#question-form-"+questionCounter).find('input[type=submit]').prop('disabled', true);
      lastQForm = $(this);
      return submitHandler(event);
   });
   return questionCounter;
}
var lastQForm;


function makeLatexPlainText(str) {
   return str.replace('\\left','').replace('\\right','');
}

function addInequalityInputRow(op, form, variable) {
   var rowsDOM = form.find('.inequality-rows');
   var rowHTML = "<a href='#'>&times;</a>";
   if(rowsDOM.children().length>0)rowHTML+= "<span class='or-label'>or &nbsp; </span>";
   if(op=="<<" || op=="<<=" || op=="<=<" || op=="<=<=") {
      rowHTML+= "<span class='ineqarg-left' style='width:50px'></span> ";
      if(op=="<<" || op=="<<=")rowHTML+= "||<||";
      else rowHTML+= "||\\leq||";
   }
   rowHTML+= "||"+variable+"||";
   if(op=="!=")rowHTML+= "||\\neq||";
   else if(op=="<<" || op=="<=<" || op=="<")rowHTML+= "||<||";
   else if(op=="<<=" || op=="<=<=" || op=="<=")rowHTML+= "||\\leq||";
   else if(op==">")rowHTML+= "||>||";
   else if(op=="=")rowHTML+= "||=||";
   else if(op==">=")rowHTML+= "||\\geq||";
   rowHTML+= "<span class='ineqarg-right' style='width:50px'></span> </div>";
   rowsDOM.append("<div>"+rowHTML+"</div>");
   MathJax.typeset();
   if(op=="<<" || op=="<<=" || op=="<=<" || op=="<=<=")rowsDOM.children().last().find('.ineqarg-left').algebraicInput();
   rowsDOM.children().last().find('.ineqarg-right').algebraicInput();
   rowsDOM.children().last().data("op", op);
   rowsDOM.children().last().data("var", variable);
   rowsDOM.children().last().find('a').click(function(){
      $(this).parent().remove();
      rowsDOM.children().first().find('.or-label').remove();
   });

}

/* --------------------------------------------------------
   -- Replaces [m]...[/m] tags with appropriate tags of LaTeX generation
   -------------------------------------------------------- */

export function replaceMathsTags(str) {
   if(!str)return str;

   // TAS-102: `str` might not actually be a string at this point, so make it so before continuing
   str = String(str);

   var prevFind = 0;
   var changed = true;
   while(str.indexOf("<p>[m]", prevFind)>=0 && changed) {
      changed = false;
      var pos1 = str.indexOf("<p>[m]");
      prevFind = pos1+3;
      var pos2 = str.indexOf("[/m]", pos1+6);
      var pos3 = str.indexOf("[/m]</p>", pos1+6);
      if(pos2==pos3 && pos2>=0) {   // is not inline
         str = str.substring(0,pos1)+"<p><span class='maths-line'>$$"+str.substring(pos1+6, pos3).replace("<", "&lt;")+"$$</span></p>" + str.substring(pos3+8);
         changed = true;
      } else if(pos2>=0) {
         str = str.substring(0, pos1) + '<p>||' + str.substring(pos1+6, pos2).replace("<", "&lt;") + '||' + str.substring(pos2+4);
         changed = true;
      }
   }
   changed = true;
   while(str.indexOf("[m]")>=0 && changed) {
      changed = false;
      // Inline
      var pos1 = str.indexOf("[m]");
      var pos2 = str.indexOf("[/m]", pos1+3);
      if(pos1<pos2) {
         str = str.substring(0, pos1) + '||' + str.substring(pos1+3, pos2).replace("<", "&lt;") + '||' + str.substring(pos2+4);
         changed = true;
      }
      else break;
   }
   return str;

}


/* --------------------------------------------------------
   -- Turns the answer (or student answer) into HTML form.
   -------------------------------------------------------- */

// This does both the process of generating the relevant HTML and any final post-processing
// that can't be done until the HTML is in place.
// This is kinda horrible and needs to be refactored. Do we really need to just generate the HTML? Is it because we might want to do the post-stuff
// to multiple containers at once?

export function insertHTMLAnswer(container, question, answer, isUserAnswer) {
   try {
      insertHTMLAnswerDo(container, question, answer, isUserAnswer);
   } catch(e) {
      console.log(e);
      container.html("This answer could not be rendered.");
   }
}

function insertHTMLAnswerDo(container, question, answer, isUserAnswer) {
   if(!question.answer) {
      container.html("[Error: Answer to this question missing]");
      return false;
   }
   if(question.answer.type=="desmos_line")question.answer.type = "desmos"; // legacy
   container.html(showHTMLAnswer(question, answer, isUserAnswer));
   if(question.answer.type=="shape") {
      container.find("canvas").dfmCanvas({
         editMode: false,
         readOnly: true,
         answerData: question.answer.data,
         answer: answer
      });
   };
   if(question.answer.type==="desmos")container.find('.desmos-calculator-solution').dfmDesmosLine({
      answerData: question.answer.data,
      answer: answer
   });

}

function stripTags(str) {
   return $("<div/>").html(str).text();
}

export function showHTMLAnswer(question, answer, isUserAnswer) {
   if (question.answer.type === "desmos_line") {
      question.answer.type = "desmos";
   }

   let typeSpecificContent = "";

   switch(question.answer.type) {
      case "multiplechoice" :
         if(question.answer.data.multiple) {
            var strs = [];
            $.each(answer, function(k,v){
               strs.push("\""+replaceMathsTags(question.answer.data.options[v-1])+"\"");
            });
            typeSpecificContent = andJoinArray(strs);
         }
         else {
            typeSpecificContent = replaceMathsTags(question.answer.data.options[answer-1]);
         }
         break;
      case "ordered" :
         var txtArray = [];
         for(var i=0; i<answer.length; i++) {
            txtArray[answer[i]-1] = replaceMathsTags(question.answer.data.items[i]);
         }
         typeSpecificContent = "the order: "+'"'+txtArray.join(", ")+'"';
         break;
      case "inequality" :
         const parts = [];
         for (let i=0; i<answer.length; i++) {
            if (!answer[i].op) {
               parts.push("");
               continue;
            }

            // "<#" means "allow < or <=", but just arbitrarily choose <= to display.
            let part;
            switch (answer[i].op.replaceAll("#","=")) {
               case "<":
                  part = answer[i].var+"<"+answer[i].args[0];
                  break;
               case "<=":
                  part = answer[i].var+"\\leq "+answer[i].args[0];
                  break;
               case ">":
                  part = answer[i].var+" > "+answer[i].args[0];
                  break;
               case ">=":
                  part = answer[i].var+"\\geq "+answer[i].args[0];
                  break;
               case "!=":
                  part = answer[i].var+"\\neq "+answer[i].args[0];
                  break;
               case "=":
                  part = answer[i].var+" = "+answer[i].args[0];
                  break;
               case "<<":
                  part = answer[i].args[0]+" < "+answer[i].var+" < "+answer[i].args[1];
                  break;
               case "<<=":
                  part = answer[i].args[0]+" < "+answer[i].var+"\\leq "+answer[i].args[1];
                  break;
               case "<=<":
                  part = answer[i].args[0]+"\\leq "+answer[i].var+" < "+answer[i].args[1];
                  break;
               case "<=<=":
                  part = answer[i].args[0]+"\\leq "+answer[i].var+"\\leq "+answer[i].args[1];
                  break;
               default:
                  console.error(`Unknown inequality operator '${answer[i].op.replaceAll("#","=")}'.`);
            }
            parts.push(part);
         }
         typeSpecificContent = "||" + parts.join("|| or ||") + "||";
         break;
      case "expression" :
         typeSpecificContent = replaceMathsTags("[m]"+(isUserAnswer ? answer : answer.main)+" [/m] ");
         break;
      case "ratio" :
         typeSpecificContent = replaceMathsTags("[m]"+answer.join(":")+"[/m]");
         break;
      case "list" :
         typeSpecificContent = answer && $.isArray(answer) ? stripTags(answer.join(", ")) : stripTags(answer);
         break;
      case "fraction" :
         var a = Array.isArray(answer) ? answer[0] : answer;
         var txt = "\\frac{"+a.numer+"}{"+a.denom+"}";
         if(question.answer.data.type==="mixed")txt = a.whole+txt;
         typeSpecificContent = replaceMathsTags("[m]"+txt+"[/m]");
         break;
      case "coordinate" :
         var txt = question.answer.data.dimensions==3 ? "\\left("+answer.x+","+answer.y+","+answer.z+"\\right)" : "\\left("+answer.x+","+answer.y+"\\right)";
         typeSpecificContent = replaceMathsTags("[m]"+txt+"[/m]");
         break;
      case "vector" :
         var matrixLatex = "";
         for(var r=0; r<answer.length; r++) {
            if(r!=0)matrixLatex+= " \\\\ ";
            matrixLatex+= answer[r].join(" && ");
         }
         typeSpecificContent = replaceMathsTags("[m]\\left(\\begin{matrix}"+matrixLatex+"\\end{matrix}\\right)[/m]");
         break;
      case "table" :
         const tableStyle = question.answer.data.tablestyle || "gdptable";
         const horizontalLines = tableStyle === "columnoperations" ? (question.answer.data.horizontalLines ?? []) : [];
         const fixedVals = question.answer.data.fixedVals || [];

         let tableHTML = `<table class='${tableStyle}'>`;

         for (let r = 0; r < question.answer.data.rows; r++) {
            const rowClass = horizontalLines.includes(r)
               ? "after-horizontal-line"
               : horizontalLines.includes(r - 1)
               ? "before-horizontal-line"
               : "";

            tableHTML += rowClass ? `<tr class='${rowClass}'>` : "<tr>";

            for (let c = 0; c < question.answer.data.cols; c++) {
               const cellContent = fixedVals[r]?.[c] !== "" ? fixedVals[r][c] : "<strong>" + stripTags(answer[r][c]) + "</strong>";
               const cellStyle =
                  `padding: 3px; min-width: 35px; height: 35px; vertical-align: middle;
                  ${fixedVals[r]?.[c] === "" ? "background-color: black; color: white;" : ""}`;

               tableHTML += "<td style='" + cellStyle + "'>" + cellContent + "</td>";
             }

            tableHTML+= "</tr>";
         }

         tableHTML+= "</table>";
         typeSpecificContent = replaceMathsTags(tableHTML);
         break;
      case "standardform" :
         var txt = stripTags(answer.main)+"\\times 10^{"+stripTags(answer.power)+"}";
         typeSpecificContent = replaceMathsTags("[m]"+txt+"[/m]");
         break;
      case "shape" :
         typeSpecificContent = "as shown:<br><br><canvas class='"+(isUserAnswer ? "their-" : "")+"solution-canvas'></canvas><br>";
         break;
      case "textual" :
         // TAS-122: If the QG supplies an explicit example answer - and they should for complex patterns - use it
         if (!isUserAnswer && question.answer.data.exampleAnswer) {
            typeSpecificContent = '"' + question.answer.data.exampleAnswer + '"';
         }
         else {
            let answerWithQuotes = [];
            for (let i = 0; i < answer.length; i++) {
               const fullAnswer = answer[i];
               let firstAnswer;
               if (!question.answer.data.showAllAnswers) {
                  // Ensure that fullAnswer is a string and not null or undefined
                  if (typeof fullAnswer === 'string') {
                     const orIndex = fullAnswer.indexOf(' OR');
                     if (orIndex !== -1) {
                        firstAnswer = fullAnswer.substring(0, orIndex);
                     }
                  }
               }
               answerWithQuotes.push('"' + stripTags(firstAnswer ?? fullAnswer) + '"');
            }
            typeSpecificContent = andJoinArray(answerWithQuotes);
         }
         break;
      case "numeric" :
         var answerStr = "";
         for(var i=0; i<question.answer.data.rows.length; i++) {
            if(i!=0)answerStr+= " and ";
            var acType = question.answer.data.rows[i].accuracy;
            var beforeStr = replaceMathsTags(question.answer.data.rows[i].before)+" ";
            var afterStr = " "+replaceMathsTags(question.answer.data.rows[i].after);
            if(acType==="range") {
                  if(isUserAnswer)answerStr+= beforeStr+stripTags(answer[i])+afterStr;
                  else answerStr+= "any value in the range "+beforeStr+answer[i].from+afterStr
                   +" to "+beforeStr+answer[i].to+afterStr;
                  
            } else {
               answerStr+= beforeStr+(isUserAnswer ? stripTags(answer[i]) : answer[i].exact)+afterStr;
            }
         }
         typeSpecificContent = answerStr;
         break;
      case "eqnsolutions" :
         var answerStrParts = [];
         var vars = question.answer.data.vars;
         for(var i=0; i<answer.length; i++) {
            var answerStrPart = [];
            for(var j=0; j<vars.length; j++) {
               var op = answer[i][j] ? answer[i][j].operator : "="; // for some reason answer[i][j] was blank during Live game?
               if(op==">=")op = "\\ge";
               if(op=="<=")op = "\\le";
               if(op=="!=")op = "\\ne";
               if(op==">#")op = "\\ge";
               if(op=="<#")op = "\\le";
               answerStrPart.push("||"+vars[j]+" "+op+" "+(answer[i][j] ? answer[i][j].answer : "-")+"||");
            }
            answerStrParts.push(answerStrPart.join(", "));
         }
         typeSpecificContent = answerStrParts.join(" "+question.answer.data.connector+" ");
         break;
      case "desmos" :
         // First set the dimensions of the input graph (see dfm_generateQuestionContentDo).
         const defaultInputGraphHeight = question.answer?.data?.mode === "boxplot" ? 120 : 400;
         const defaultInputGraphWidth = 350;
         const maxInputGraphWidth = 449;
         const inputGraphHeight = question.answer?.data?.desmosAnswerHeight ?? defaultInputGraphHeight;
         const inputGraphWidth = Math.min(maxInputGraphWidth, question.answer?.data?.desmosAnswerWidth ?? defaultInputGraphWidth);

         // Use the same dimensions for the correct answer graph, scaling down if necessary.
         const maxAnswerGraphWidth = 350;
         let answerGraphWidth = inputGraphWidth;
         let answerGraphHeight = inputGraphHeight;
         if (answerGraphWidth > maxAnswerGraphWidth) {
            answerGraphHeight = Math.round((maxAnswerGraphWidth / answerGraphWidth) * answerGraphHeight);
            answerGraphWidth = maxAnswerGraphWidth;
         }

         typeSpecificContent = `<br><div class='desmos-calculator-solution' style='width: ${answerGraphWidth}px; height: ${answerGraphHeight}px;'></div>`;
         break;
      case "none" :
         typeSpecificContent = "";
         break;
      default :
         typeSpecificContent = "This answer could not be rendered.";
   }

   var beforeStr = question?.answer?.data?.before ? replaceMathsTags(question.answer.data.before + " ") : "";
   var afterStr = question?.answer?.data?.after ? replaceMathsTags(" " + question.answer.data.after) : "";

   return beforeStr + typeSpecificContent + afterStr;
}
